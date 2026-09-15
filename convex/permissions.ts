import { QueryCtx, MutationCtx, internalMutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  hasPermission,
  type PermissionFlag,
} from "./permissionFlags";

// The flag constants live in `./permissionFlags` (no server imports) so client
// code can use them without pulling Convex's server runtime into the browser.
// Re-exported here so backend modules keep importing from one place.
export * from "./permissionFlags";

/**
 * `DEFAULT_ROLE_PERMISSIONS` is only read once, when `createServer` inserts
 * a new server's `@everyone` role — bumping the constant above does nothing
 * for servers that already exist. Run this once per environment after
 * deploying a change to it: `npx convex run permissions:backfillConnectPermission`.
 */
export const backfillConnectPermission = internalMutation({
  args: {},
  handler: async (ctx) => {
    const roles = await ctx.db.query("roles").collect();
    for (const role of roles) {
      if (role.isDefault && (role.permissions & PERMISSIONS.CONNECT) === 0) {
        await ctx.db.patch(role._id, {
          permissions: role.permissions | PERMISSIONS.CONNECT,
        });
      }
    }
  },
});

/**
 * Computes a member's effective permission bitmask within a server:
 * the server owner always has every permission; otherwise it's the
 * bitwise OR of every role assigned to the member (which always
 * includes the server's `@everyone` default role).
 */
export async function getEffectivePermissions(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<"servers">,
  userId: Id<"users">,
): Promise<number> {
  const server = await ctx.db.get(serverId);
  if (!server) return 0;
  if (server.ownerId === userId) return ALL_PERMISSIONS;

  const membership = await ctx.db
    .query("serverMembers")
    .withIndex("by_server_and_user", (q) =>
      q.eq("serverId", serverId).eq("userId", userId),
    )
    .unique();
  if (!membership) return 0;

  const assignments = await ctx.db
    .query("memberRoles")
    .withIndex("by_server_and_user", (q) =>
      q.eq("serverId", serverId).eq("userId", userId),
    )
    .collect();

  const defaultRole = await ctx.db
    .query("roles")
    .withIndex("by_server", (q) => q.eq("serverId", serverId))
    .filter((q) => q.eq(q.field("isDefault"), true))
    .unique();

  let bitmask = defaultRole?.permissions ?? 0;
  for (const assignment of assignments) {
    const role = await ctx.db.get(assignment.roleId);
    if (role) bitmask |= role.permissions;
  }
  return bitmask;
}

export async function requireMembership(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<"servers">,
  userId: Id<"users">,
): Promise<Doc<"serverMembers"> | null> {
  const server = await ctx.db.get(serverId);
  if (!server) throw new Error("Server not found");
  if (server.ownerId === userId) return null; // owner is always allowed, no membership row needed for the check
  const membership = await ctx.db
    .query("serverMembers")
    .withIndex("by_server_and_user", (q) =>
      q.eq("serverId", serverId).eq("userId", userId),
    )
    .unique();
  if (!membership) throw new Error("Not a member of this server");
  return membership;
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<"servers">,
  userId: Id<"users">,
  flag: PermissionFlag,
): Promise<void> {
  await requireMembership(ctx, serverId, userId);
  const bitmask = await getEffectivePermissions(ctx, serverId, userId);
  if (!hasPermission(bitmask, flag)) {
    throw new Error("You do not have permission to perform this action");
  }
}

/**
 * The highest `position` among a member's assigned roles (server owner is
 * treated as above every role). Used to enforce role-hierarchy rules so a
 * member can only manage/assign roles ranked below their own highest role.
 */
export async function getHighestRolePosition(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<"servers">,
  userId: Id<"users">,
): Promise<number> {
  const server = await ctx.db.get(serverId);
  if (server?.ownerId === userId) return Number.POSITIVE_INFINITY;

  const assignments = await ctx.db
    .query("memberRoles")
    .withIndex("by_server_and_user", (q) =>
      q.eq("serverId", serverId).eq("userId", userId),
    )
    .collect();

  let highest = 0;
  for (const assignment of assignments) {
    const role = await ctx.db.get(assignment.roleId);
    if (role && role.position > highest) highest = role.position;
  }
  return highest;
}

/**
 * Layers a channel's permission overrides (Discord-style channel overwrites)
 * on top of a member's server-wide effective permissions, in the same
 * precedence order Discord uses: @everyone channel overwrite, then the
 * union of the member's other role overwrites, then a member-specific
 * overwrite last (highest precedence). Administrators bypass overwrites
 * entirely, same as at the server level.
 */
export async function getEffectiveChannelPermissions(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
): Promise<number> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return 0;

  const base = await getEffectivePermissions(ctx, channel.serverId, userId);
  if (base & PERMISSIONS.ADMINISTRATOR) return ALL_PERMISSIONS;

  const overrides = await ctx.db
    .query("channelPermissionOverrides")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  if (overrides.length === 0) return base;

  const defaultRole = await ctx.db
    .query("roles")
    .withIndex("by_server", (q) => q.eq("serverId", channel.serverId))
    .filter((q) => q.eq(q.field("isDefault"), true))
    .unique();
  const myRoleIds = new Set(
    (
      await ctx.db
        .query("memberRoles")
        .withIndex("by_server_and_user", (q) =>
          q.eq("serverId", channel.serverId).eq("userId", userId),
        )
        .collect()
    ).map((r) => r.roleId),
  );

  return applyChannelOverrides(base, overrides, defaultRole?._id, myRoleIds, userId);
}

/**
 * Batched variant of `getEffectiveChannelPermissions` for listing every
 * channel in a server at once: fetches that server's overrides and the
 * member's roles a single time each, instead of once per channel.
 */
export async function getEffectiveChannelPermissionsForServer(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<"servers">,
  userId: Id<"users">,
  channelIds: Id<"channels">[],
): Promise<Map<Id<"channels">, number>> {
  const base = await getEffectivePermissions(ctx, serverId, userId);
  const result = new Map<Id<"channels">, number>();
  if (base & PERMISSIONS.ADMINISTRATOR) {
    for (const channelId of channelIds) result.set(channelId, ALL_PERMISSIONS);
    return result;
  }

  const overrides = await ctx.db
    .query("channelPermissionOverrides")
    .withIndex("by_server", (q) => q.eq("serverId", serverId))
    .collect();
  const overridesByChannel = new Map<Id<"channels">, typeof overrides>();
  for (const o of overrides) {
    const list = overridesByChannel.get(o.channelId);
    if (list) list.push(o);
    else overridesByChannel.set(o.channelId, [o]);
  }

  const defaultRole = await ctx.db
    .query("roles")
    .withIndex("by_server", (q) => q.eq("serverId", serverId))
    .filter((q) => q.eq(q.field("isDefault"), true))
    .unique();
  const myRoleIds = new Set(
    (
      await ctx.db
        .query("memberRoles")
        .withIndex("by_server_and_user", (q) =>
          q.eq("serverId", serverId).eq("userId", userId),
        )
        .collect()
    ).map((r) => r.roleId),
  );

  for (const channelId of channelIds) {
    const channelOverrides = overridesByChannel.get(channelId);
    result.set(
      channelId,
      channelOverrides
        ? applyChannelOverrides(base, channelOverrides, defaultRole?._id, myRoleIds, userId)
        : base,
    );
  }
  return result;
}

function applyChannelOverrides(
  base: number,
  overrides: Doc<"channelPermissionOverrides">[],
  defaultRoleId: Id<"roles"> | undefined,
  myRoleIds: Set<Id<"roles">>,
  userId: Id<"users">,
): number {
  let bitmask = base;

  const everyoneOverride = overrides.find(
    (o) => o.targetType === "role" && defaultRoleId && o.targetId === defaultRoleId,
  );
  if (everyoneOverride) {
    bitmask = (bitmask & ~everyoneOverride.deny) | everyoneOverride.allow;
  }

  let roleAllow = 0;
  let roleDeny = 0;
  for (const o of overrides) {
    if (
      o.targetType === "role" &&
      o.targetId !== defaultRoleId &&
      myRoleIds.has(o.targetId as Id<"roles">)
    ) {
      roleAllow |= o.allow;
      roleDeny |= o.deny;
    }
  }
  bitmask = (bitmask & ~roleDeny) | roleAllow;

  const memberOverride = overrides.find(
    (o) => o.targetType === "member" && o.targetId === userId,
  );
  if (memberOverride) {
    bitmask = (bitmask & ~memberOverride.deny) | memberOverride.allow;
  }

  return bitmask;
}

export async function requireChannelPermission(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
  flag: PermissionFlag,
): Promise<void> {
  const bitmask = await getEffectiveChannelPermissions(ctx, channelId, userId);
  if ((bitmask & flag) === 0) {
    throw new Error("You do not have permission to perform this action in this channel");
  }
}
