import { v } from "convex/values";
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { getCurrentUserOrThrow, getOrCreateCurrentUser } from "./users";
import { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { MAX_MESSAGE_LENGTH } from "./chatLimits";

function orderPair(a: Id<"users">, b: Id<"users">): [Id<"users">, Id<"users">] {
  return a < b ? [a, b] : [b, a];
}

async function areFriends(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
) {
  const [userA, userB] = orderPair(a, b);
  const friendship = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("userA", userA).eq("userB", userB))
    .unique();
  return friendship !== null;
}

export const getOrCreateConversation = mutation({
  args: { otherUserId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await getOrCreateCurrentUser(ctx);
    if (args.otherUserId === me._id) {
      throw new Error("You can't DM yourself");
    }
    if (!(await areFriends(ctx, me._id, args.otherUserId))) {
      throw new Error("You can only DM your friends");
    }
    const [userA, userB] = orderPair(me._id, args.otherUserId);
    const existing = await ctx.db
      .query("dmConversations")
      .withIndex("by_pair", (q) => q.eq("userA", userA).eq("userB", userB))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("dmConversations", { userA, userB });
  },
});

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const asA = await ctx.db
      .query("dmConversations")
      .withIndex("by_userA", (q) => q.eq("userA", me._id))
      .collect();
    const asB = await ctx.db
      .query("dmConversations")
      .withIndex("by_userB", (q) => q.eq("userB", me._id))
      .collect();
    const all = [...asA, ...asB];
    return await Promise.all(
      all.map(async (c) => {
        const otherId = c.userA === me._id ? c.userB : c.userA;
        return { ...c, otherUser: await ctx.db.get(otherId) };
      }),
    );
  },
});

async function requireConversationAccess(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<"dmConversations">,
  userId: Id<"users">,
) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.userA !== userId && conversation.userB !== userId) {
    throw new Error("You don't have access to this conversation");
  }
  return conversation;
}

export const listMessages = query({
  args: {
    conversationId: v.id("dmConversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireConversationAccess(ctx, args.conversationId, me._id);
    const results = await ctx.db
      .query("dmMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      results.page.map(async (m) => ({
        ...m,
        author: await ctx.db.get(m.authorId),
      })),
    );
    return { ...results, page };
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("dmConversations"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await getOrCreateCurrentUser(ctx);
    const conversation = await requireConversationAccess(
      ctx,
      args.conversationId,
      me._id,
    );
    const otherId =
      conversation.userA === me._id ? conversation.userB : conversation.userA;
    if (!(await areFriends(ctx, me._id, otherId))) {
      throw new Error("You're no longer friends with this user");
    }
    const content = args.content.trim();
    if (!content) throw new Error("Message can't be empty");
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Messages can't be longer than ${MAX_MESSAGE_LENGTH} characters`);
    }
    return await ctx.db.insert("dmMessages", {
      conversationId: args.conversationId,
      authorId: me._id,
      content,
    });
  },
});

export const editMessage = mutation({
  args: { messageId: v.id("dmMessages"), content: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    if (message.authorId !== me._id) {
      throw new Error("You can only edit your own messages");
    }
    const content = args.content.trim();
    if (!content) throw new Error("Message can't be empty");
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Messages can't be longer than ${MAX_MESSAGE_LENGTH} characters`);
    }
    await ctx.db.patch(args.messageId, { content, editedAt: Date.now() });
  },
});

export const deleteMessage = mutation({
  args: { messageId: v.id("dmMessages") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    if (message.authorId !== me._id) {
      throw new Error("You can only delete your own messages");
    }
    await ctx.db.delete(args.messageId);
  },
});
