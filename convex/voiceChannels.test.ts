import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { PERMISSIONS } from "./permissions";

// NOTE: `joinVoiceChannel` itself makes real `fetch` calls to Cloudflare's
// RealtimeKit REST API and is NOT exercised here — that, along with webhook
// signature verification against the real RealtimeKit public key and actual
// WebRTC audio/video, requires a live two-browser-session pass (see the
// plan's rollout section). These tests only cover the pure queries/mutations.

function asUser(t: ReturnType<typeof convexTest>, subject: string, name: string) {
  return t.withIdentity({ subject, name });
}

async function createUser(t: ReturnType<typeof convexTest>, subject: string, name: string) {
  const user = asUser(t, subject, name);
  await user.mutation(api.users.ensureCurrentUser, {});
  const doc = await user.query(api.users.getCurrentUser, {});
  if (!doc) throw new Error("user not created");
  return { as: user, doc };
}

async function joinServer(
  owner: Awaited<ReturnType<typeof createUser>>,
  member: Awaited<ReturnType<typeof createUser>>,
  serverId: Id<"servers">,
) {
  const inviteId = await owner.as.mutation(api.invites.createInvite, { serverId });
  const invites = await owner.as.query(api.invites.listServerInvites, { serverId });
  const invite = invites.find((i) => i._id === inviteId)!;
  await member.as.mutation(api.invites.joinByInvite, { code: invite.code });
}

test("creating a channel with type voice produces a voice channel", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });

  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "General Voice",
    type: "voice",
  });
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  const channel = channels.find((c) => c._id === channelId)!;
  expect(channel.type).toBe("voice");
});

test("a member without CONNECT (denied via channel override) is rejected by assertCanJoin", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const member = await createUser(t, "member", "Member");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  await joinServer(owner, member, serverId);

  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "General Voice",
    type: "voice",
  });
  const roles = await owner.as.query(api.roles.listRoles, { serverId });
  const defaultRole = roles.find((r) => r.isDefault)!;
  await owner.as.mutation(api.channelPermissions.setChannelOverride, {
    channelId,
    targetType: "role",
    targetId: defaultRole._id,
    allow: 0,
    deny: PERMISSIONS.CONNECT,
  });

  await expect(
    member.as.query(internal.voiceChannels.assertCanJoin, { channelId, now: Date.now() }),
  ).rejects.toThrow();

  // The owner is unaffected by the override.
  await expect(
    owner.as.query(internal.voiceChannels.assertCanJoin, { channelId, now: Date.now() }),
  ).resolves.toMatchObject({ activeRtkMeetingId: null, cachedToken: null });
});

test("assertCanJoin returns a fresh cached token and rejects stale ones", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice",
    type: "voice",
  });
  await owner.as.mutation(internal.voiceChannels.recordMeetingCreated, {
    channelId,
    serverId,
    rtkMeetingId: "meeting-1",
  });
  await owner.as.mutation(internal.voiceChannels.storeVoiceToken, {
    userId: owner.doc._id,
    channelId,
    serverId,
    rtkMeetingId: "meeting-1",
    rtkParticipantId: "p-1",
    authToken: "tok-1",
    displayName: owner.doc.displayName,
  });

  const now = Date.now();
  await expect(
    owner.as.query(internal.voiceChannels.assertCanJoin, { channelId, now }),
  ).resolves.toMatchObject({
    activeRtkMeetingId: "meeting-1",
    cachedToken: { authToken: "tok-1", rtkMeetingId: "meeting-1" },
  });

  // 31 days later the token is considered stale and must be re-issued.
  await expect(
    owner.as.query(internal.voiceChannels.assertCanJoin, {
      channelId,
      now: now + 31 * 24 * 60 * 60 * 1000,
    }),
  ).resolves.toMatchObject({ cachedToken: null });

  // A rename invalidates it too (the name is baked into the RTK participant).
  await owner.as.mutation(api.users.updateProfile, { displayName: "Renamed" });
  await expect(
    owner.as.query(internal.voiceChannels.assertCanJoin, { channelId, now }),
  ).resolves.toMatchObject({ cachedToken: null });
});

test("myVoiceTokens hides tokens for channels the user can no longer CONNECT to", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const member = await createUser(t, "member", "Member");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  await joinServer(owner, member, serverId);
  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice",
    type: "voice",
  });
  await owner.as.mutation(internal.voiceChannels.recordMeetingCreated, {
    channelId,
    serverId,
    rtkMeetingId: "meeting-1",
  });
  await member.as.mutation(internal.voiceChannels.storeVoiceToken, {
    userId: member.doc._id,
    channelId,
    serverId,
    rtkMeetingId: "meeting-1",
    rtkParticipantId: "p-1",
    authToken: "tok-member",
    displayName: member.doc.displayName,
  });

  const now = Date.now();
  expect(await member.as.query(api.voiceChannels.myVoiceTokens, { now })).toEqual([
    { channelId, serverId, authToken: "tok-member", rtkMeetingId: "meeting-1" },
  ]);
  // Tokens are private to their owner.
  expect(await owner.as.query(api.voiceChannels.myVoiceTokens, { now })).toEqual([]);

  const roles = await owner.as.query(api.roles.listRoles, { serverId });
  const defaultRole = roles.find((r) => r.isDefault)!;
  await owner.as.mutation(api.channelPermissions.setChannelOverride, {
    channelId,
    targetType: "role",
    targetId: defaultRole._id,
    allow: 0,
    deny: PERMISSIONS.CONNECT,
  });
  expect(await member.as.query(api.voiceChannels.myVoiceTokens, { now })).toEqual([]);
});

test("markJoined requires CONNECT, records the beacon token, and leaveByBeacon removes the row", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const member = await createUser(t, "member", "Member");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  await joinServer(owner, member, serverId);
  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice",
    type: "voice",
  });

  // No meeting yet: the client must call ensureVoiceToken first.
  await expect(
    member.as.mutation(api.voiceChannels.markJoined, { channelId, beaconToken: "b-1" }),
  ).rejects.toThrow();

  await owner.as.mutation(internal.voiceChannels.recordMeetingCreated, {
    channelId,
    serverId,
    rtkMeetingId: "meeting-1",
  });
  await member.as.mutation(api.voiceChannels.markJoined, { channelId, beaconToken: "b-1" });

  let participants = await owner.as.query(api.voiceChannels.listVoiceParticipants, { serverId });
  expect(participants).toHaveLength(1);
  expect(participants[0].userId).toBe(member.doc._id);

  // The webhook's re-upsert for the same channel keeps the beacon token.
  await t.mutation(internal.voiceChannels.reconcileParticipantJoined, {
    rtkMeetingId: "meeting-1",
    userId: member.doc._id,
  });
  const rows = await t.run(async (ctx) => ctx.db.query("voiceParticipants").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].beaconToken).toBe("b-1");

  // Wrong token does nothing; the right one (unauthenticated) removes the row.
  await t.mutation(api.voiceChannels.leaveByBeacon, { beaconToken: "nope" });
  participants = await owner.as.query(api.voiceChannels.listVoiceParticipants, { serverId });
  expect(participants).toHaveLength(1);
  await t.mutation(api.voiceChannels.leaveByBeacon, { beaconToken: "b-1" });
  participants = await owner.as.query(api.voiceChannels.listVoiceParticipants, { serverId });
  expect(participants).toHaveLength(0);

  // Denied CONNECT → markJoined refuses.
  const roles = await owner.as.query(api.roles.listRoles, { serverId });
  const defaultRole = roles.find((r) => r.isDefault)!;
  await owner.as.mutation(api.channelPermissions.setChannelOverride, {
    channelId,
    targetType: "role",
    targetId: defaultRole._id,
    allow: 0,
    deny: PERMISSIONS.CONNECT,
  });
  await expect(
    member.as.mutation(api.voiceChannels.markJoined, { channelId, beaconToken: "b-2" }),
  ).rejects.toThrow();
});

test("reapStaleVoiceParticipants deletes only rows past the heartbeat cutoff", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const member = await createUser(t, "member", "Member");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  await joinServer(owner, member, serverId);
  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice",
    type: "voice",
  });
  for (const user of [owner, member]) {
    await t.mutation(internal.voiceChannels.recordUserJoinedVoiceChannel, {
      channelId,
      serverId,
      userId: user.doc._id,
      rtkMeetingId: "meeting-1",
    });
  }
  // Age only the member's heartbeat.
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("voiceParticipants").collect();
    const stale = rows.find((r) => r.userId === member.doc._id)!;
    await ctx.db.patch(stale._id, { lastSeenAt: Date.now() - 5 * 60_000 });
  });

  await t.mutation(internal.voiceChannels.reapStaleVoiceParticipants, {});

  const participants = await owner.as.query(api.voiceChannels.listVoiceParticipants, { serverId });
  expect(participants).toHaveLength(1);
  expect(participants[0].userId).toBe(owner.doc._id);
});

test("recordUserJoinedVoiceChannel enforces one call at a time", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });

  const channelA = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice-a",
    type: "voice",
  });
  const channelB = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice-b",
    type: "voice",
  });

  await owner.as.mutation(internal.voiceChannels.recordUserJoinedVoiceChannel, {
    channelId: channelA,
    serverId,
    userId: owner.doc._id,
    rtkMeetingId: "meeting-a",
  });
  let active = await owner.as.query(api.voiceChannels.myActiveCall, {});
  expect(active?.channelId).toBe(channelA);

  await owner.as.mutation(internal.voiceChannels.recordUserJoinedVoiceChannel, {
    channelId: channelB,
    serverId,
    userId: owner.doc._id,
    rtkMeetingId: "meeting-b",
  });
  active = await owner.as.query(api.voiceChannels.myActiveCall, {});
  expect(active?.channelId).toBe(channelB);

  const participants = await owner.as.query(api.voiceChannels.listVoiceParticipants, {
    serverId,
  });
  expect(participants).toHaveLength(1);
  expect(participants[0].channelId).toBe(channelB);
});

test("reconcileParticipantLeft removes the participant's row", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice",
    type: "voice",
  });

  await owner.as.mutation(internal.voiceChannels.recordUserJoinedVoiceChannel, {
    channelId,
    serverId,
    userId: owner.doc._id,
    rtkMeetingId: "meeting-1",
  });
  expect((await owner.as.query(api.voiceChannels.myActiveCall, {}))?.channelId).toBe(channelId);

  await owner.as.mutation(internal.voiceChannels.reconcileParticipantLeft, {
    rtkMeetingId: "meeting-1",
    userId: owner.doc._id,
  });
  expect(await owner.as.query(api.voiceChannels.myActiveCall, {})).toBeNull();
});

test("reconcileMeetingEnded clears every participant of that meeting", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const member = await createUser(t, "member", "Member");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  await joinServer(owner, member, serverId);
  const channelId = await owner.as.mutation(api.channels.createChannel, {
    serverId,
    name: "voice",
    type: "voice",
  });

  await owner.as.mutation(internal.voiceChannels.recordMeetingCreated, {
    channelId,
    serverId,
    rtkMeetingId: "meeting-1",
  });
  await owner.as.mutation(internal.voiceChannels.recordUserJoinedVoiceChannel, {
    channelId,
    serverId,
    userId: owner.doc._id,
    rtkMeetingId: "meeting-1",
  });
  await owner.as.mutation(internal.voiceChannels.recordUserJoinedVoiceChannel, {
    channelId,
    serverId,
    userId: member.doc._id,
    rtkMeetingId: "meeting-1",
  });

  await owner.as.mutation(internal.voiceChannels.reconcileMeetingEnded, {
    rtkMeetingId: "meeting-1",
  });

  const participants = await owner.as.query(api.voiceChannels.listVoiceParticipants, {
    serverId,
  });
  expect(participants).toHaveLength(0);
});

test("backfillConnectPermission only touches default roles missing the bit", async () => {
  const t = convexTest(schema);
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });

  const customRoleId = await owner.as.mutation(api.roles.createRole, {
    serverId,
    name: "Custom",
    permissions: PERMISSIONS.SEND_MESSAGES,
  });

  // Simulate a pre-migration default role that predates the CONNECT bit.
  await t.run(async (ctx) => {
    const roles = await ctx.db.query("roles").collect();
    const defaultRole = roles.find((r) => r.isDefault)!;
    await ctx.db.patch(defaultRole._id, {
      permissions: defaultRole.permissions & ~PERMISSIONS.CONNECT,
    });
  });

  await t.mutation(internal.permissions.backfillConnectPermission, {});

  const roles = await owner.as.query(api.roles.listRoles, { serverId });
  const defaultRole = roles.find((r) => r.isDefault)!;
  const customRole = roles.find((r) => r._id === customRoleId)!;
  expect(defaultRole.permissions & PERMISSIONS.CONNECT).not.toBe(0);
  expect(customRole.permissions & PERMISSIONS.CONNECT).toBe(0);
});
