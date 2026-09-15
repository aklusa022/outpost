import { v } from "convex/values";
import { query, mutation, QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserOrThrow, getOrCreateCurrentUser } from "./users";
import {
  PERMISSIONS,
  hasPermission,
  getEffectivePermissions,
  requireMembership,
  requireChannelPermission,
} from "./permissions";
import { deleteAttachmentsForMessage, withUrls } from "./attachments";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_LENGTH } from "./chatLimits";

async function hydrate(ctx: QueryCtx, m: Doc<"messages">) {
  const rows = await ctx.db
    .query("attachments")
    .withIndex("by_message", (q) => q.eq("messageId", m._id))
    .collect();
  return {
    ...m,
    author: await ctx.db.get(m.authorId),
    attachments: await withUrls(rows.filter((r) => r.status === "ready")),
  };
}

export const listMessages = query({
  args: {
    channelId: v.id("channels"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.VIEW_CHANNELS);
    const results = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(results.page.map((m) => hydrate(ctx, m)));
    return { ...results, page };
  },
});

export const searchMessages = query({
  args: { channelId: v.id("channels"), query: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.VIEW_CHANNELS);
    const query = args.query.trim();
    if (!query) return [];
    const results = await ctx.db
      .query("messages")
      .withSearchIndex("search_content", (q) =>
        q.search("content", query).eq("channelId", args.channelId),
      )
      .take(25);
    return await Promise.all(results.map((m) => hydrate(ctx, m)));
  },
});

export const sendMessage = mutation({
  args: {
    channelId: v.id("channels"),
    content: v.string(),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
  },
  handler: async (ctx, args) => {
    const me = await getOrCreateCurrentUser(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.SEND_MESSAGES);
    const content = args.content.trim();
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Messages can't be longer than ${MAX_MESSAGE_LENGTH} characters`);
    }
    const attachmentIds = [...new Set(args.attachmentIds ?? [])];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files`);
    }
    if (!content && attachmentIds.length === 0) throw new Error("Message can't be empty");

    // Every attachment must be this user's finished upload for this channel
    // and not already on another message.
    const attachments: Doc<"attachments">[] = [];
    for (const id of attachmentIds) {
      const row = await ctx.db.get(id);
      if (
        !row ||
        row.uploaderId !== me._id ||
        row.channelId !== args.channelId ||
        row.status !== "ready" ||
        row.messageId
      ) {
        throw new Error("One of the attachments is missing or still uploading");
      }
      attachments.push(row);
    }
    if (attachments.length > 0) {
      await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.ATTACH_FILES);
    }

    const messageId: Id<"messages"> = await ctx.db.insert("messages", {
      channelId: args.channelId,
      authorId: me._id,
      content,
    });
    for (const row of attachments) await ctx.db.patch(row._id, { messageId });
    return messageId;
  },
});

export const editMessage = mutation({
  args: { messageId: v.id("messages"), content: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    if (message.authorId !== me._id) {
      throw new Error("You can only edit your own messages");
    }
    const content = args.content.trim();
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Messages can't be longer than ${MAX_MESSAGE_LENGTH} characters`);
    }
    if (!content) {
      const attached = await ctx.db
        .query("attachments")
        .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
        .first();
      if (!attached) throw new Error("Message can't be empty");
    }
    await ctx.db.patch(args.messageId, { content, editedAt: Date.now() });
  },
});

export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    const channel = await ctx.db.get(message.channelId);
    if (!channel) throw new Error("Channel not found");

    if (message.authorId !== me._id) {
      await requireMembership(ctx, channel.serverId, me._id);
      const bitmask = await getEffectivePermissions(ctx, channel.serverId, me._id);
      if (!hasPermission(bitmask, PERMISSIONS.MANAGE_MESSAGES)) {
        throw new Error(
          "You can only delete your own messages, unless you have Manage Messages",
        );
      }
    }
    await deleteAttachmentsForMessage(ctx, args.messageId);
    await ctx.db.delete(args.messageId);
  },
});
