import { v } from "convex/values";
import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getCurrentUserOrThrow } from "./users";
import {
  PERMISSIONS,
  getEffectiveChannelPermissionsForServer,
  requireMembership,
  requirePermission,
} from "./permissions";
import { deleteChannelCascade } from "./channelCascade";

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export const listChannels = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, args.serverId, me._id);
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    const effective = await getEffectiveChannelPermissionsForServer(
      ctx,
      args.serverId,
      me._id,
      channels.map((c) => c._id),
    );
    return channels
      .filter((c) => (effective.get(c._id) ?? 0) & PERMISSIONS.VIEW_CHANNELS)
      .sort((a, b) => a.position - b.position);
  },
});

export const createChannel = mutation({
  args: {
    serverId: v.id("servers"),
    categoryId: v.id("categories"),
    name: v.string(),
    type: v.optional(v.union(v.literal("text"), v.literal("voice"))),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(ctx, args.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const name = slugify(args.name);
    if (!name) throw new Error("Channel name can't be empty");
    const category = await ctx.db.get(args.categoryId);
    if (!category || category.serverId !== args.serverId) {
      throw new Error("Category not found on this server");
    }
    const siblings = await ctx.db
      .query("channels")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
    const position = siblings.reduce((max, c) => Math.max(max, c.position), -1) + 1;
    return await ctx.db.insert("channels", {
      serverId: args.serverId,
      categoryId: args.categoryId,
      name,
      position,
      type: args.type ?? "text",
    });
  },
});

export const renameChannel = mutation({
  args: { channelId: v.id("channels"), name: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requirePermission(ctx, channel.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const name = slugify(args.name);
    if (!name) throw new Error("Channel name can't be empty");
    await ctx.db.patch(args.channelId, { name });
  },
});

/** Renumbers a category's channels 0..n in the given order, patching only what changed. */
async function renumberCategory(
  ctx: MutationCtx,
  ordered: { _id: Id<"channels">; position: number; categoryId?: Id<"categories"> }[],
  categoryId: Id<"categories">,
) {
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    if (c.position !== i || c.categoryId !== categoryId) {
      await ctx.db.patch(c._id, { position: i, categoryId });
    }
  }
}

/**
 * Drag-and-drop primitive: put `channelId` at `index` within `categoryId`
 * (which may be its current category or another one on the same server).
 * Both the source and target categories are renumbered so positions stay
 * dense and unique.
 */
export const moveChannel = mutation({
  args: {
    channelId: v.id("channels"),
    categoryId: v.id("categories"),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requirePermission(ctx, channel.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const target = await ctx.db.get(args.categoryId);
    if (!target || target.serverId !== channel.serverId) {
      throw new Error("Category not found on this server");
    }

    const targetSiblings = (
      await ctx.db
        .query("channels")
        .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
        .collect()
    )
      .filter((c) => c._id !== channel._id)
      .sort((a, b) => a.position - b.position);
    const index = Math.max(0, Math.min(Math.floor(args.index), targetSiblings.length));
    targetSiblings.splice(index, 0, channel);
    await renumberCategory(ctx, targetSiblings, args.categoryId);

    if (channel.categoryId && channel.categoryId !== args.categoryId) {
      const sourceSiblings = (
        await ctx.db
          .query("channels")
          .withIndex("by_category", (q) => q.eq("categoryId", channel.categoryId))
          .collect()
      )
        .filter((c) => c._id !== channel._id)
        .sort((a, b) => a.position - b.position);
      await renumberCategory(ctx, sourceSiblings, channel.categoryId);
    }
  },
});

export const deleteChannel = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requirePermission(ctx, channel.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    await deleteChannelCascade(ctx, channel);
  },
});

/**
 * One-off migration for the "every channel has a category" rule: assigns
 * each server's category-less channels to its first category (creating
 * "Text Channels" if the server has none). Run once per deployment before
 * the schema makes `categoryId` required:
 * `npx convex run channels:backfillCategories`.
 */
export const backfillCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orphans = (await ctx.db.query("channels").collect()).filter((c) => !c.categoryId);
    const byServer = new Map<Id<"servers">, typeof orphans>();
    for (const c of orphans) {
      const list = byServer.get(c.serverId) ?? [];
      list.push(c);
      byServer.set(c.serverId, list);
    }
    let moved = 0;
    for (const [serverId, channels] of byServer) {
      const categories = await ctx.db
        .query("categories")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .collect();
      let target = categories.sort((a, b) => a.position - b.position)[0];
      if (!target) {
        const id = await ctx.db.insert("categories", { serverId, name: "Text Channels", position: 0 });
        target = (await ctx.db.get(id))!;
      }
      const existing = await ctx.db
        .query("channels")
        .withIndex("by_category", (q) => q.eq("categoryId", target._id))
        .collect();
      let next = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;
      for (const c of channels.sort((a, b) => a.position - b.position)) {
        await ctx.db.patch(c._id, { categoryId: target._id, position: next++ });
        moved++;
      }
    }
    return { moved };
  },
});
