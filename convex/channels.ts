import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";
import {
  PERMISSIONS,
  getEffectiveChannelPermissionsForServer,
  requireMembership,
  requirePermission,
} from "./permissions";

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
    categoryId: v.optional(v.id("categories")),
    name: v.string(),
    type: v.optional(v.union(v.literal("text"), v.literal("voice"))),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requirePermission(
      ctx,
      args.serverId,
      me._id,
      PERMISSIONS.MANAGE_CHANNELS,
    );
    const name = args.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!name) throw new Error("Channel name can't be empty");
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.serverId !== args.serverId) {
        throw new Error("Category not found on this server");
      }
    }
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    const position =
      existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;
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
    await requirePermission(
      ctx,
      channel.serverId,
      me._id,
      PERMISSIONS.MANAGE_CHANNELS,
    );
    const name = args.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!name) throw new Error("Channel name can't be empty");
    await ctx.db.patch(args.channelId, { name });
  },
});

export const moveChannel = mutation({
  args: {
    channelId: v.id("channels"),
    categoryId: v.optional(v.id("categories")),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requirePermission(
      ctx,
      channel.serverId,
      me._id,
      PERMISSIONS.MANAGE_CHANNELS,
    );
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.serverId !== channel.serverId) {
        throw new Error("Category not found on this server");
      }
    }
    await ctx.db.patch(args.channelId, {
      categoryId: args.categoryId,
      position: args.position,
    });
  },
});

export const deleteChannel = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requirePermission(
      ctx,
      channel.serverId,
      me._id,
      PERMISSIONS.MANAGE_CHANNELS,
    );
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const message of messages) await ctx.db.delete(message._id);

    if (channel.type === "voice") {
      for (const status of ["active", "ended"] as const) {
        const sessions = await ctx.db
          .query("voiceChannelSessions")
          .withIndex("by_channel_and_status", (q) =>
            q.eq("channelId", args.channelId).eq("status", status),
          )
          .collect();
        for (const session of sessions) await ctx.db.delete(session._id);
      }
      const participants = await ctx.db
        .query("voiceParticipants")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .collect();
      for (const participant of participants) await ctx.db.delete(participant._id);
      const tokens = await ctx.db
        .query("voiceParticipantTokens")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
    }

    const overrides = await ctx.db
      .query("channelPermissionOverrides")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const override of overrides) await ctx.db.delete(override._id);

    await ctx.db.delete(args.channelId);
  },
});
