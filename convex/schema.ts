import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    username: v.string(),
    displayName: v.string(),
    imageUrl: v.string(),
    // User-chosen status, independent of actual connection state (tracked
    // separately by the `presence` component). "invisible" means: show me
    // as offline to others regardless of whether I'm actually connected.
    status: v.optional(
      v.union(
        v.literal("online"),
        v.literal("idle"),
        v.literal("dnd"),
        v.literal("invisible"),
      ),
    ),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_username", ["username"]),

  friendRequests: defineTable({
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
  })
    .index("by_to", ["toUserId"])
    .index("by_from", ["fromUserId"])
    .index("by_from_and_to", ["fromUserId", "toUserId"]),

  friendships: defineTable({
    userA: v.id("users"),
    userB: v.id("users"),
  })
    .index("by_userA", ["userA"])
    .index("by_userB", ["userB"])
    .index("by_pair", ["userA", "userB"]),

  servers: defineTable({
    name: v.string(),
    imageUrl: v.optional(v.string()),
    ownerId: v.id("users"),
  }).index("by_owner", ["ownerId"]),

  serverMembers: defineTable({
    serverId: v.id("servers"),
    userId: v.id("users"),
    nickname: v.optional(v.string()),
  })
    .index("by_server", ["serverId"])
    .index("by_user", ["userId"])
    .index("by_server_and_user", ["serverId", "userId"]),

  bannedUsers: defineTable({
    serverId: v.id("servers"),
    userId: v.id("users"),
    bannedBy: v.id("users"),
    reason: v.optional(v.string()),
  })
    .index("by_server", ["serverId"])
    .index("by_server_and_user", ["serverId", "userId"]),

  roles: defineTable({
    serverId: v.id("servers"),
    name: v.string(),
    color: v.optional(v.string()),
    position: v.number(),
    permissions: v.number(),
    isDefault: v.boolean(),
  })
    .index("by_server", ["serverId"])
    .index("by_server_and_position", ["serverId", "position"]),

  memberRoles: defineTable({
    serverId: v.id("servers"),
    userId: v.id("users"),
    roleId: v.id("roles"),
  })
    .index("by_server_and_user", ["serverId", "userId"])
    .index("by_role", ["roleId"]),

  // `position` is 0..n within the server (see `reorderCategory`).
  categories: defineTable({
    serverId: v.id("servers"),
    name: v.string(),
    position: v.number(),
  })
    .index("by_server", ["serverId"])
    .index("by_server_and_position", ["serverId", "position"]),

  // Every channel belongs to a category; `position` is 0..n *within* that
  // category (renumbered by `moveChannel`).
  channels: defineTable({
    serverId: v.id("servers"),
    categoryId: v.id("categories"),
    name: v.string(),
    position: v.number(),
    type: v.union(v.literal("text"), v.literal("voice")),
  })
    .index("by_server", ["serverId"])
    .index("by_category", ["categoryId"])
    .index("by_category_and_position", ["categoryId", "position"]),

  // The persistent RealtimeKit *meeting* backing a voice channel, created
  // lazily on the first join and reused forever after. A RealtimeKit meeting
  // is a durable room; live "sessions" start and end inside it on their own
  // (the SDK/webhooks track those), and participant tokens stay valid across
  // sessions of the same meeting — which is what lets us cache tokens in
  // `voiceParticipantTokens` and skip the REST round trip on every join.
  // `status` stays "active" for the life of the channel; rows with "ended"
  // are legacy leftovers from when a new meeting was created per session.
  // Kept separate from `channels`, which stays purely structural.
  voiceChannelSessions: defineTable({
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    rtkMeetingId: v.string(),
    status: v.union(v.literal("active"), v.literal("ended")),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_channel_and_status", ["channelId", "status"])
    .index("by_rtkMeetingId", ["rtkMeetingId"]),

  // High-churn presence table, deliberately separate from `serverMembers`.
  // One row per user currently connected to a voice channel anywhere (a
  // user can only be in one call at a time).
  voiceParticipants: defineTable({
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    userId: v.id("users"),
    rtkMeetingId: v.string(),
    rtkParticipantId: v.optional(v.string()),
    // RealtimeKit peer id of the *current* join instance (set by the client
    // once the media join completes). Webhooks carry the same id, which lets
    // a late `participantLeft` for an earlier join be told apart from this one.
    rtkPeerId: v.optional(v.string()),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
    // Random, client-generated secret for this tab's call. Lets the tab
    // remove its own row without auth via `navigator.sendBeacon` on unload
    // (a normal authenticated mutation can't complete during page teardown).
    beaconToken: v.optional(v.string()),
  })
    .index("by_channel", ["channelId"])
    .index("by_server", ["serverId"])
    .index("by_user", ["userId"])
    .index("by_rtkMeetingId_and_userId", ["rtkMeetingId", "userId"])
    .index("by_beaconToken", ["beaconToken"])
    .index("by_lastSeenAt", ["lastSeenAt"]),

  // Cached RealtimeKit participant tokens, one per (user, channel). Tokens
  // are issued by the REST API once, are valid for ~100 days, and can join
  // any number of live sessions of the same meeting — so after the first
  // join of a channel, later joins need no server round trip at all. Only
  // ever returned to the owning user. `displayName` is recorded because the
  // name is baked into the RealtimeKit participant at creation; a rename
  // invalidates the cached token so a fresh one is issued.
  voiceParticipantTokens: defineTable({
    userId: v.id("users"),
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    rtkMeetingId: v.string(),
    rtkParticipantId: v.string(),
    authToken: v.string(),
    displayName: v.string(),
    issuedAt: v.number(),
  })
    .index("by_user_and_channel", ["userId", "channelId"])
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"]),

  // Per-channel permission overrides (Discord-style channel overwrites),
  // layered on top of the server-wide role bitmask from
  // `getEffectivePermissions`. Small per channel, so it's fetched wholesale
  // (by channel or by server) rather than point-queried per permission check.
  channelPermissionOverrides: defineTable({
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    targetType: v.union(v.literal("role"), v.literal("member")),
    targetId: v.union(v.id("roles"), v.id("users")),
    allow: v.number(),
    deny: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_server", ["serverId"])
    .index("by_channel_and_target", ["channelId", "targetType", "targetId"]),

  // Cached copy of RealtimeKit's webhook-signing public key, refreshed
  // lazily on a TTL to avoid an external HTTPS round trip on every webhook
  // delivery's signature-verification path.
  webhookKeyCache: defineTable({
    provider: v.literal("realtimekit"),
    publicKeyPem: v.string(),
    fetchedAt: v.number(),
  }).index("by_provider", ["provider"]),

  messages: defineTable({
    channelId: v.id("channels"),
    authorId: v.id("users"),
    content: v.string(),
    editedAt: v.optional(v.number()),
  })
    .index("by_channel", ["channelId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["channelId"],
    }),

  // Files uploaded to R2 for channel messages. A row is inserted as
  // "pending" when the presigned PUT URL is handed out, flipped to "ready"
  // by `attachments.finalizeUpload` once the object has been verified
  // (size/type via HEAD), and linked to a message by `messages.sendMessage`.
  // Pending rows that never get finalized are reaped by a cron.
  attachments: defineTable({
    channelId: v.id("channels"),
    serverId: v.id("servers"),
    uploaderId: v.id("users"),
    messageId: v.optional(v.id("messages")),
    // R2 object key (random UUID); the bucket comes from the deployment env.
    key: v.string(),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    kind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("text"),
      v.literal("file"),
    ),
    status: v.union(v.literal("pending"), v.literal("ready")),
    // First TEXT_PREVIEW_MAX_CHARS characters of a `.txt` upload.
    textPreview: v.optional(v.string()),
  })
    .index("by_message", ["messageId"])
    .index("by_channel", ["channelId"])
    .index("by_status", ["status"]),

  invites: defineTable({
    serverId: v.id("servers"),
    code: v.string(),
    createdBy: v.id("users"),
    expiresAt: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    uses: v.number(),
  })
    .index("by_server", ["serverId"])
    .index("by_code", ["code"]),

  dmConversations: defineTable({
    userA: v.id("users"),
    userB: v.id("users"),
  })
    .index("by_userA", ["userA"])
    .index("by_userB", ["userB"])
    .index("by_pair", ["userA", "userB"]),

  dmMessages: defineTable({
    conversationId: v.id("dmConversations"),
    authorId: v.id("users"),
    content: v.string(),
    editedAt: v.optional(v.number()),
  }).index("by_conversation", ["conversationId"]),
});
