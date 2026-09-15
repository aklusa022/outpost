import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";
import { PERMISSIONS, requireMembership, requirePermission } from "./permissions";
import { deleteChannelCascade } from "./channelCascade";

export const listCategories = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, args.serverId, me._id);
    const categories = await ctx.db
      .query("categories")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    return categories.sort((a, b) => a.position - b.position);
  },
});

export const createCategory = mutation({
  args: { serverId: v.id("servers"), name: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(ctx, args.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const name = args.name.trim();
    if (!name) throw new Error("Category name can't be empty");
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    const position = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;
    return await ctx.db.insert("categories", {
      serverId: args.serverId,
      name,
      position,
    });
  },
});

export const renameCategory = mutation({
  args: { categoryId: v.id("categories"), name: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    await requirePermission(ctx, category.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const name = args.name.trim();
    if (!name) throw new Error("Category name can't be empty");
    await ctx.db.patch(args.categoryId, { name });
  },
});

/** Drag-and-drop primitive: put the category at `index` and renumber the rest 0..n. */
export const reorderCategory = mutation({
  args: { categoryId: v.id("categories"), index: v.number() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    await requirePermission(ctx, category.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const others = (
      await ctx.db
        .query("categories")
        .withIndex("by_server", (q) => q.eq("serverId", category.serverId))
        .collect()
    )
      .filter((c) => c._id !== category._id)
      .sort((a, b) => a.position - b.position);
    const index = Math.max(0, Math.min(Math.floor(args.index), others.length));
    others.splice(index, 0, category);
    for (let i = 0; i < others.length; i++) {
      if (others[i].position !== i) await ctx.db.patch(others[i]._id, { position: i });
    }
  },
});

/**
 * Deletes a category and every channel in it (channels can't exist outside
 * a category). A server must always keep at least one category so new
 * channels have somewhere to go.
 */
export const deleteCategory = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    await requirePermission(ctx, category.serverId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    const siblings = await ctx.db
      .query("categories")
      .withIndex("by_server", (q) => q.eq("serverId", category.serverId))
      .collect();
    if (siblings.length <= 1) {
      throw new Error("A server needs at least one category");
    }
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
    for (const channel of channels) await deleteChannelCascade(ctx, channel);
    await ctx.db.delete(args.categoryId);
  },
});
