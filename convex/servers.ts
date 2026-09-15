import { v } from "convex/values";
import { query, mutation, MutationCtx } from "./_generated/server";
import { getCurrentUserOrThrow, getOrCreateCurrentUser } from "./users";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  getEffectivePermissions,
  getHighestRolePosition,
  requireMembership,
  requirePermission,
} from "./permissions";
import { Id } from "./_generated/dataModel";
import { deleteChannelCascade } from "./channelCascade";

export const createServer = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const me = await getOrCreateCurrentUser(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Server name can't be empty");

    const serverId = await ctx.db.insert("servers", {
      name,
      ownerId: me._id,
    });
    await ctx.db.insert("roles", {
      serverId,
      name: "@everyone",
      position: 0,
      permissions: DEFAULT_ROLE_PERMISSIONS,
      isDefault: true,
    });
    await ctx.db.insert("serverMembers", {
      serverId,
      userId: me._id,
    });
    const textCategoryId = await ctx.db.insert("categories", {
      serverId,
      name: "Text Channels",
      position: 0,
    });
    await ctx.db.insert("channels", {
      serverId,
      categoryId: textCategoryId,
      name: "general",
      position: 0,
      type: "text",
    });
    const voiceCategoryId = await ctx.db.insert("categories", {
      serverId,
      name: "Voice Channels",
      position: 1,
    });
    await ctx.db.insert("channels", {
      serverId,
      categoryId: voiceCategoryId,
      name: "general",
      position: 0,
      type: "voice",
    });
    return serverId;
  },
});

export const listMyServers = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const memberships = await ctx.db
      .query("serverMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const servers = await Promise.all(
      memberships.map((m) => ctx.db.get(m.serverId)),
    );
    return servers.filter((s): s is NonNullable<typeof s> => s !== null);
  },
});

export const getServer = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, args.serverId, me._id);
    return await ctx.db.get(args.serverId);
  },
});

export const getMyPermissions = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(args.serverId);
    if (!server) throw new Error("Server not found");
    const isOwner = server.ownerId === me._id;
    const bitmask = await getEffectivePermissions(ctx, args.serverId, me._id);
    const highestRolePosition = await getHighestRolePosition(
      ctx,
      args.serverId,
      me._id,
    );
    return { bitmask, isOwner, userId: me._id, highestRolePosition };
  },
});

export const updateServer = mutation({
  args: { serverId: v.id("servers"), name: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(
      ctx,
      args.serverId,
      me._id,
      PERMISSIONS.MANAGE_SERVER,
    );
    const name = args.name.trim();
    if (!name) throw new Error("Server name can't be empty");
    await ctx.db.patch(args.serverId, { name });
  },
});

export const deleteServer = mutation({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(args.serverId);
    if (!server) throw new Error("Server not found");
    if (server.ownerId !== me._id) {
      throw new Error("Only the server owner can delete the server");
    }

    const members = await ctx.db
      .query("serverMembers")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const row of members) await ctx.db.delete(row._id);

    const memberRoles = await ctx.db
      .query("memberRoles")
      .withIndex("by_server_and_user", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const row of memberRoles) await ctx.db.delete(row._id);

    const roles = await ctx.db
      .query("roles")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const row of roles) await ctx.db.delete(row._id);

    const categories = await ctx.db
      .query("categories")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const row of categories) await ctx.db.delete(row._id);

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const row of invites) await ctx.db.delete(row._id);

    const bans = await ctx.db
      .query("bannedUsers")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const row of bans) await ctx.db.delete(row._id);

    const channels = await ctx.db
      .query("channels")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    for (const channel of channels) await deleteChannelCascade(ctx, channel);

    await ctx.db.delete(args.serverId);
  },
});

export const leaveServer = mutation({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(args.serverId);
    if (!server) throw new Error("Server not found");
    if (server.ownerId === me._id) {
      throw new Error(
        "The server owner can't leave — delete the server instead",
      );
    }
    const membership = await ctx.db
      .query("serverMembers")
      .withIndex("by_server_and_user", (q) =>
        q.eq("serverId", args.serverId).eq("userId", me._id),
      )
      .unique();
    if (!membership) throw new Error("You're not a member of this server");
    await ctx.db.delete(membership._id);

    const roleAssignments = await ctx.db
      .query("memberRoles")
      .withIndex("by_server_and_user", (q) =>
        q.eq("serverId", args.serverId).eq("userId", me._id),
      )
      .collect();
    for (const assignment of roleAssignments) await ctx.db.delete(assignment._id);
  },
});

export const listMembers = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, args.serverId, me._id);
    const members = await ctx.db
      .query("serverMembers")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    return await Promise.all(
      members.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const roleAssignments = await ctx.db
          .query("memberRoles")
          .withIndex("by_server_and_user", (q) =>
            q.eq("serverId", args.serverId).eq("userId", m.userId),
          )
          .collect();
        const roles = await Promise.all(
          roleAssignments.map((a) => ctx.db.get(a.roleId)),
        );
        return { ...m, user, roles: roles.filter((r) => r !== null) };
      }),
    );
  },
});

async function removeMemberInternal(
  ctx: MutationCtx,
  serverId: Id<"servers">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("serverMembers")
    .withIndex("by_server_and_user", (q) =>
      q.eq("serverId", serverId).eq("userId", userId),
    )
    .unique();
  if (membership) await ctx.db.delete(membership._id);
  const roleAssignments = await ctx.db
    .query("memberRoles")
    .withIndex("by_server_and_user", (q) =>
      q.eq("serverId", serverId).eq("userId", userId),
    )
    .collect();
  for (const assignment of roleAssignments) await ctx.db.delete(assignment._id);
}

export const kickMember = mutation({
  args: { serverId: v.id("servers"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(
      ctx,
      args.serverId,
      me._id,
      PERMISSIONS.KICK_MEMBERS,
    );
    const server = await ctx.db.get(args.serverId);
    if (server?.ownerId === args.userId) {
      throw new Error("You can't kick the server owner");
    }
    const myPosition = await getHighestRolePosition(ctx, args.serverId, me._id);
    const theirPosition = await getHighestRolePosition(
      ctx,
      args.serverId,
      args.userId,
    );
    if (theirPosition >= myPosition) {
      throw new Error("You can't kick a member with an equal or higher role");
    }
    await removeMemberInternal(ctx, args.serverId, args.userId);
  },
});

export const banMember = mutation({
  args: {
    serverId: v.id("servers"),
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(
      ctx,
      args.serverId,
      me._id,
      PERMISSIONS.BAN_MEMBERS,
    );
    const server = await ctx.db.get(args.serverId);
    if (server?.ownerId === args.userId) {
      throw new Error("You can't ban the server owner");
    }
    const myPosition = await getHighestRolePosition(ctx, args.serverId, me._id);
    const theirPosition = await getHighestRolePosition(
      ctx,
      args.serverId,
      args.userId,
    );
    if (theirPosition >= myPosition) {
      throw new Error("You can't ban a member with an equal or higher role");
    }
    await removeMemberInternal(ctx, args.serverId, args.userId);
    await ctx.db.insert("bannedUsers", {
      serverId: args.serverId,
      userId: args.userId,
      bannedBy: me._id,
      reason: args.reason,
    });
  },
});

export const unbanMember = mutation({
  args: { serverId: v.id("servers"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(
      ctx,
      args.serverId,
      me._id,
      PERMISSIONS.BAN_MEMBERS,
    );
    const ban = await ctx.db
      .query("bannedUsers")
      .withIndex("by_server_and_user", (q) =>
        q.eq("serverId", args.serverId).eq("userId", args.userId),
      )
      .unique();
    if (ban) await ctx.db.delete(ban._id);
  },
});

export const listBans = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(
      ctx,
      args.serverId,
      me._id,
      PERMISSIONS.BAN_MEMBERS,
    );
    const bans = await ctx.db
      .query("bannedUsers")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    return await Promise.all(
      bans.map(async (b) => ({ ...b, user: await ctx.db.get(b.userId) })),
    );
  },
});
