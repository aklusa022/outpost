import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserOrThrow } from "./users";
import { PERMISSIONS, requireMembership, requireChannelPermission } from "./permissions";

// RealtimeKit participant tokens are valid for 100 days. We re-issue well
// before that so a cached token never expires mid-call.
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// A participant row whose heartbeat is older than this is considered dead
// (tab killed, network gone) and gets reaped by the cron in `crons.ts`. The
// client heartbeats every 20s, so this allows three missed beats.
export const STALE_PARTICIPANT_MS = 60_000;

async function rtkFetch(path: string, method: "GET" | "POST", body?: unknown) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const appId = process.env.REALTIMEKIT_APP_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !appId || !token) {
    throw new Error(
      "Cloudflare RealtimeKit is not configured (CLOUDFLARE_ACCOUNT_ID / REALTIMEKIT_APP_ID / CLOUDFLARE_API_TOKEN)",
    );
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const json = (await res.json()) as {
    success: boolean;
    data: unknown;
    error?: unknown;
    errors?: unknown;
  };
  if (!res.ok || !json.success) {
    throw new Error(
      `RealtimeKit API error (${path}): ${JSON.stringify(json.error ?? json.errors ?? json)}`,
    );
  }
  return json.data as Record<string, unknown>;
}

export const listVoiceParticipants = query({
  args: { serverId: v.id("servers") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, args.serverId, me._id);
    const rows = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    return Promise.all(
      rows.map(async (r) => ({
        channelId: r.channelId,
        userId: r.userId,
        joinedAt: r.joinedAt,
        user: await ctx.db.get(r.userId),
      })),
    );
  },
});

export const myActiveCall = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    if (!row) return null;
    const channel = await ctx.db.get(row.channelId);
    if (!channel) return null;
    return { channelId: row.channelId, serverId: row.serverId, channelName: channel.name };
  },
});

async function getChannelMeeting(ctx: QueryCtx | MutationCtx, channelId: Id<"channels">) {
  return ctx.db
    .query("voiceChannelSessions")
    .withIndex("by_channel_and_status", (q) => q.eq("channelId", channelId).eq("status", "active"))
    .unique();
}

// A cached token is usable only if it belongs to the channel's current
// meeting, was issued under the user's current display name (RealtimeKit
// bakes the name into the participant), and is comfortably inside its
// validity window. `now` is passed in by the caller (mutations/actions may
// read the clock; queries must not).
function isTokenFresh(
  token: Doc<"voiceParticipantTokens">,
  rtkMeetingId: string,
  displayName: string,
  now: number,
) {
  return (
    token.rtkMeetingId === rtkMeetingId &&
    token.displayName === displayName &&
    now - token.issuedAt < TOKEN_MAX_AGE_MS
  );
}

export const assertCanJoin = internalQuery({
  args: { channelId: v.id("channels"), now: v.number() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    if (channel.type !== "voice") throw new Error("Not a voice channel");
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.CONNECT);

    const meeting = await getChannelMeeting(ctx, args.channelId);
    const activeRtkMeetingId = meeting?.rtkMeetingId ?? null;

    let cachedToken: { authToken: string; rtkMeetingId: string } | null = null;
    if (activeRtkMeetingId) {
      const token = await ctx.db
        .query("voiceParticipantTokens")
        .withIndex("by_user_and_channel", (q) =>
          q.eq("userId", me._id).eq("channelId", args.channelId),
        )
        .unique();
      if (token && isTokenFresh(token, activeRtkMeetingId, me.displayName, args.now)) {
        cachedToken = { authToken: token.authToken, rtkMeetingId: token.rtkMeetingId };
      }
    }

    return { me, channel, activeRtkMeetingId, cachedToken };
  },
});

export const recordMeetingCreated = internalMutation({
  args: { channelId: v.id("channels"), serverId: v.id("servers"), rtkMeetingId: v.string() },
  handler: async (ctx, args) => {
    const existing = await getChannelMeeting(ctx, args.channelId);
    if (existing) return existing.rtkMeetingId;
    await ctx.db.insert("voiceChannelSessions", {
      channelId: args.channelId,
      serverId: args.serverId,
      rtkMeetingId: args.rtkMeetingId,
      status: "active",
      startedAt: Date.now(),
    });
    return args.rtkMeetingId;
  },
});

export const storeVoiceToken = internalMutation({
  args: {
    userId: v.id("users"),
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    rtkMeetingId: v.string(),
    rtkParticipantId: v.string(),
    authToken: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("voiceParticipantTokens")
      .withIndex("by_user_and_channel", (q) =>
        q.eq("userId", args.userId).eq("channelId", args.channelId),
      )
      .unique();
    const doc = { ...args, issuedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("voiceParticipantTokens", doc);
  },
});

// Every cached token the caller may currently use, so the client can join
// a channel with zero server round trips. Filtered by a live CONNECT check
// per channel: this query is reactive, so revoking the permission removes
// the token from every subscribed client immediately.
export const myVoiceTokens = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const me = await getCurrentUserOrThrow(ctx);
    const tokens = await ctx.db
      .query("voiceParticipantTokens")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .take(200);

    const usable: {
      channelId: Id<"channels">;
      serverId: Id<"servers">;
      authToken: string;
      rtkMeetingId: string;
    }[] = [];
    for (const token of tokens) {
      const meeting = await getChannelMeeting(ctx, token.channelId);
      if (!meeting) continue;
      if (!isTokenFresh(token, meeting.rtkMeetingId, me.displayName, args.now)) continue;
      try {
        await requireChannelPermission(ctx, token.channelId, me._id, PERMISSIONS.CONNECT);
      } catch {
        continue;
      }
      usable.push({
        channelId: token.channelId,
        serverId: token.serverId,
        authToken: token.authToken,
        rtkMeetingId: token.rtkMeetingId,
      });
    }
    return usable;
  },
});

// Returns a RealtimeKit participant token for the caller in this channel,
// issuing one via the REST API only when there is no fresh cached token
// (or when `force` is set — the client uses that after the SDK rejects a
// cached token). The channel's meeting is created on first use.
export const ensureVoiceToken = action({
  args: { channelId: v.id("channels"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ authToken: string; rtkMeetingId: string }> => {
    const {
      me,
      channel,
      activeRtkMeetingId,
      cachedToken,
    }: {
      me: Doc<"users">;
      channel: Doc<"channels">;
      activeRtkMeetingId: string | null;
      cachedToken: { authToken: string; rtkMeetingId: string } | null;
    } = await ctx.runQuery(internal.voiceChannels.assertCanJoin, {
      channelId: args.channelId,
      now: Date.now(),
    });

    if (cachedToken && !args.force) return cachedToken;

    let rtkMeetingId = activeRtkMeetingId;
    if (!rtkMeetingId) {
      const meeting = await rtkFetch("/meetings", "POST", {
        title: `channel-${args.channelId}`,
      });
      rtkMeetingId = (await ctx.runMutation(internal.voiceChannels.recordMeetingCreated, {
        channelId: args.channelId,
        serverId: channel.serverId,
        rtkMeetingId: meeting.id as string,
      })) as string;
    }

    const participant = await rtkFetch(`/meetings/${rtkMeetingId}/participants`, "POST", {
      name: me.displayName,
      preset_name: process.env.REALTIMEKIT_PRESET_NAME,
      custom_participant_id: me._id,
    });
    const authToken = participant.token as string;

    await ctx.runMutation(internal.voiceChannels.storeVoiceToken, {
      userId: me._id,
      channelId: args.channelId,
      serverId: channel.serverId,
      rtkMeetingId,
      rtkParticipantId: participant.id as string,
      authToken,
      displayName: me.displayName,
    });

    return { authToken, rtkMeetingId };
  },
});

async function upsertVoiceParticipant(
  ctx: MutationCtx,
  args: {
    channelId: Id<"channels">;
    serverId: Id<"servers">;
    userId: Id<"users">;
    rtkMeetingId: string;
    rtkParticipantId?: string;
    beaconToken?: string;
  },
) {
  const existing = await ctx.db
    .query("voiceParticipants")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique();

  // Already in this very channel (e.g. the webhook confirming a join the
  // client already recorded): just refresh, keeping joinedAt/beaconToken.
  if (existing && existing.channelId === args.channelId) {
    await ctx.db.patch(existing._id, {
      lastSeenAt: Date.now(),
      rtkMeetingId: args.rtkMeetingId,
      ...(args.rtkParticipantId ? { rtkParticipantId: args.rtkParticipantId } : {}),
      ...(args.beaconToken ? { beaconToken: args.beaconToken } : {}),
    });
    return;
  }

  // One call per user: moving channels replaces the old row.
  if (existing) await ctx.db.delete(existing._id);

  await ctx.db.insert("voiceParticipants", {
    channelId: args.channelId,
    serverId: args.serverId,
    userId: args.userId,
    rtkMeetingId: args.rtkMeetingId,
    rtkParticipantId: args.rtkParticipantId,
    beaconToken: args.beaconToken,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  });
}

export const recordUserJoinedVoiceChannel = internalMutation({
  args: {
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    userId: v.id("users"),
    rtkMeetingId: v.string(),
    rtkParticipantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertVoiceParticipant(ctx, args);
  },
});

// Called by the client the moment it starts joining (in parallel with the
// WebRTC join), so everyone else's roster updates at click time. Also the
// hard authorization guard: a client holding a cached token but no longer
// allowed to CONNECT fails here and tears its call down.
export const markJoined = mutation({
  args: { channelId: v.id("channels"), beaconToken: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    if (channel.type !== "voice") throw new Error("Not a voice channel");
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.CONNECT);
    const meeting = await getChannelMeeting(ctx, args.channelId);
    if (!meeting) throw new Error("Voice channel has no meeting yet");
    await upsertVoiceParticipant(ctx, {
      channelId: args.channelId,
      serverId: channel.serverId,
      userId: me._id,
      rtkMeetingId: meeting.rtkMeetingId,
      beaconToken: args.beaconToken,
    });
  },
});

export const leaveVoiceChannel = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// Deliberately unauthenticated: it's sent via `navigator.sendBeacon` while
// the tab is unloading, where no auth'd Convex call can complete. The only
// thing it can do is delete the one row carrying this random token.
export const leaveByBeacon = mutation({
  args: { beaconToken: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_beaconToken", (q) => q.eq("beaconToken", args.beaconToken))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// Periodic liveness ping. The first call after the media join also records
// the RealtimeKit peer id so webhook reconciliation can match this exact join.
export const heartbeat = mutation({
  args: { peerId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      lastSeenAt: Date.now(),
      ...(args.peerId ? { rtkPeerId: args.peerId } : {}),
    });
  },
});

// Last-resort cleanup for clients that vanished without leaving (crash,
// network loss) and whose RealtimeKit webhook never arrived. Runs from
// `crons.ts`; the leave button, the unload beacon, and the webhook all
// clear rows far sooner in the normal cases.
export const reapStaleVoiceParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_PARTICIPANT_MS;
    const stale = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_lastSeenAt", (q) => q.lt("lastSeenAt", cutoff))
      .take(100);
    for (const row of stale) await ctx.db.delete(row._id);
    if (stale.length === 100) {
      await ctx.scheduler.runAfter(0, internal.voiceChannels.reapStaleVoiceParticipants, {});
    }
  },
});

// RealtimeKit webhooks are delivered late (seen 6–15 s) and out of order
// relative to our own mutations, so none of the reconcilers below may create
// state or delete state they can't prove is theirs. Every join is already
// recorded by the client's `markJoined` at click time; a stale
// `participantJoined` arriving after the client left must NOT resurrect the
// row (that's the "user reappears in the roster for a while" bug).
export const reconcileParticipantJoined = internalMutation({
  args: { rtkMeetingId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_rtkMeetingId_and_userId", (q) =>
        q.eq("rtkMeetingId", args.rtkMeetingId).eq("userId", args.userId),
      )
      .unique();
    if (row) await ctx.db.patch(row._id, { lastSeenAt: Date.now() });
  },
});

// Only removes the row if it belongs to the very join instance that left
// (peer ids match). A row without a peer id yet (media join still in flight)
// or with a newer one (user re-joined) is left alone; the reaper covers the
// crash case.
export const reconcileParticipantLeft = internalMutation({
  args: { rtkMeetingId: v.string(), userId: v.id("users"), peerId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_rtkMeetingId_and_userId", (q) =>
        q.eq("rtkMeetingId", args.rtkMeetingId).eq("userId", args.userId),
      )
      .unique();
    if (row && row.rtkPeerId === args.peerId) await ctx.db.delete(row._id);
  },
});

// One missed 20 s client heartbeat.
const MEETING_ENDED_STALE_MS = 30_000;

// A RealtimeKit *session* ended (last participant left). The meeting itself
// persists and is reused for the channel's next call, so the session row is
// left untouched. Because this can arrive a minute after the fact, only rows
// no live client is heartbeating are cleared — a quick re-join keeps its row.
export const reconcileMeetingEnded = internalMutation({
  args: { rtkMeetingId: v.string() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - MEETING_ENDED_STALE_MS;
    const rows = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_rtkMeetingId_and_userId", (q) => q.eq("rtkMeetingId", args.rtkMeetingId))
      .collect();
    for (const row of rows) {
      if (row.lastSeenAt < cutoff) await ctx.db.delete(row._id);
    }
  },
});

// One-time setup per environment: registers the Cloudflare RealtimeKit
// webhook against this deployment's HTTP action URL. Run manually via
// `npx convex run voiceChannels:registerWebhook` (and again with `--prod`)
// — never automatically, since re-running it would create a duplicate.
export const registerWebhook = internalAction({
  args: {},
  handler: async () => {
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not available");
    const result = await rtkFetch("/webhooks", "POST", {
      name: "disclone",
      url: `${siteUrl}/realtimekit-webhook`,
      events: ["meeting.participantJoined", "meeting.participantLeft", "meeting.ended"],
      enabled: true,
    });
    console.log("Registered RealtimeKit webhook:", result);
    return result;
  },
});
