import { MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { deleteAttachmentsForChannel } from "./attachments";

/**
 * Removes a channel and everything hanging off it: messages, attachments
 * (rows + R2 objects), voice sessions/participants/cached tokens, and
 * permission overrides. Shared by `deleteChannel`, `deleteCategory` and
 * `deleteServer` so the three cascades can't drift apart.
 */
export async function deleteChannelCascade(
  ctx: MutationCtx,
  channel: Doc<"channels">,
) {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
    .collect();
  for (const message of messages) await ctx.db.delete(message._id);

  await deleteAttachmentsForChannel(ctx, channel._id);

  if (channel.type === "voice") {
    for (const status of ["active", "ended"] as const) {
      const sessions = await ctx.db
        .query("voiceChannelSessions")
        .withIndex("by_channel_and_status", (q) =>
          q.eq("channelId", channel._id).eq("status", status),
        )
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
    }
    const participants = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .collect();
    for (const participant of participants) await ctx.db.delete(participant._id);
    const tokens = await ctx.db
      .query("voiceParticipantTokens")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
  }

  const overrides = await ctx.db
    .query("channelPermissionOverrides")
    .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
    .collect();
  for (const override of overrides) await ctx.db.delete(override._id);

  await ctx.db.delete(channel._id);
}
