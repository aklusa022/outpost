import { convexTest } from "convex-test";
import { beforeAll, expect, test, vi } from "vitest";
import r2Test from "@convex-dev/r2/test";
import actionRetrierTest from "@convex-dev/action-retrier/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { PERMISSIONS } from "./permissionFlags";
import { MAX_ATTACHMENT_BYTES, MAX_MESSAGE_LENGTH } from "./chatLimits";

// Presigning only needs config, never the network, so dummy credentials are
// enough for `createUploadUrl`. `finalizeUpload` (HEAD/GET against R2) is
// not exercised here; rows are flipped to "ready" directly.
beforeAll(() => {
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.stubEnv("R2_ENDPOINT", "https://example.r2.cloudflarestorage.com");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
});

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

async function setup() {
  const t = convexTest(schema);
  // r2's helper registers the retrier at the top level, but our app mounts it
  // nested under r2 (`r2/actionRetrier`), which is the path deleteObject uses.
  t.registerComponent("r2", r2Test.schema, r2Test.modules);
  t.registerComponent("r2/actionRetrier", actionRetrierTest.schema, actionRetrierTest.modules);
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  const channel = channels.find((c) => c.type === "text")!;
  return { t, owner, serverId, channelId: channel._id };
}

async function joinServer(
  owner: Awaited<ReturnType<typeof createUser>>,
  member: Awaited<ReturnType<typeof createUser>>,
  serverId: Id<"servers">,
) {
  const inviteId = await owner.as.mutation(api.invites.createInvite, { serverId });
  const invites = await owner.as.query(api.invites.listServerInvites, { serverId });
  await member.as.mutation(api.invites.joinByInvite, { code: invites.find((i) => i._id === inviteId)!.code });
}

const png = { name: "photo.png", contentType: "image/png", size: 1024 };

test("createUploadUrl hands out a presigned PUT and a pending row", async () => {
  const { t, owner, channelId } = await setup();
  const { attachmentId, url } = await owner.as.mutation(api.attachments.createUploadUrl, { channelId, ...png });
  expect(url).toContain("test-bucket");
  expect(url).toContain("X-Amz-Signature=");
  const row = await t.run((ctx) => ctx.db.get(attachmentId));
  expect(row).toMatchObject({ status: "pending", kind: "image", name: "photo.png", channelId });
});

test("createUploadUrl enforces the size cap and the blocked-type list", async () => {
  const { owner, channelId } = await setup();
  await expect(
    owner.as.mutation(api.attachments.createUploadUrl, {
      channelId,
      ...png,
      size: MAX_ATTACHMENT_BYTES + 1,
    }),
  ).rejects.toThrow(/10 MB/);
  await expect(
    owner.as.mutation(api.attachments.createUploadUrl, {
      channelId,
      name: "page.html",
      contentType: "text/html",
      size: 10,
    }),
  ).rejects.toThrow(/isn't allowed/);
});

test("createUploadUrl requires the Attach Files permission", async () => {
  const { t, owner, serverId, channelId } = await setup();
  const member = await createUser(t, "member", "Member");
  await joinServer(owner, member, serverId);
  const roles = await owner.as.query(api.roles.listRoles, { serverId });
  const everyone = roles.find((r) => r.isDefault)!;
  await owner.as.mutation(api.roles.updateRole, {
    roleId: everyone._id,
    permissions: everyone.permissions & ~PERMISSIONS.ATTACH_FILES,
  });
  await expect(
    member.as.mutation(api.attachments.createUploadUrl, { channelId, ...png }),
  ).rejects.toThrow(/permission/);
});

test("sendMessage links ready attachments and rejects pending or foreign ones", async () => {
  const { t, owner, serverId, channelId } = await setup();
  const { attachmentId } = await owner.as.mutation(api.attachments.createUploadUrl, { channelId, ...png });

  await expect(
    owner.as.mutation(api.messages.sendMessage, { channelId, content: "", attachmentIds: [attachmentId] }),
  ).rejects.toThrow(/still uploading/);

  await t.mutation(internal.attachments.markReady, { attachmentId, size: 1024, contentType: "image/png" });
  const messageId = await owner.as.mutation(api.messages.sendMessage, {
    channelId,
    content: "",
    attachmentIds: [attachmentId],
  });
  const page = await owner.as.query(api.messages.listMessages, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  const sent = page.page.find((m) => m._id === messageId)!;
  expect(sent.attachments).toHaveLength(1);
  expect(sent.attachments[0]).toMatchObject({ name: "photo.png", kind: "image" });
  expect(sent.attachments[0].downloadUrl).toContain("response-content-disposition");

  // Already attached → can't be reused; someone else's upload → rejected.
  await expect(
    owner.as.mutation(api.messages.sendMessage, { channelId, content: "again", attachmentIds: [attachmentId] }),
  ).rejects.toThrow();
  const member = await createUser(t, "member", "Member");
  await joinServer(owner, member, serverId);
  const theirs = await member.as.mutation(api.attachments.createUploadUrl, { channelId, ...png });
  await t.mutation(internal.attachments.markReady, {
    attachmentId: theirs.attachmentId,
    size: 1024,
    contentType: "image/png",
  });
  await expect(
    owner.as.mutation(api.messages.sendMessage, {
      channelId,
      content: "",
      attachmentIds: [theirs.attachmentId],
    }),
  ).rejects.toThrow();
});

test("with R2_PUBLIC_URL set, attachments get plain CDN URLs instead of presigned ones", async () => {
  const { t, owner, channelId } = await setup();
  const { attachmentId } = await owner.as.mutation(api.attachments.createUploadUrl, { channelId, ...png });
  await t.mutation(internal.attachments.markReady, { attachmentId, size: 1024, contentType: "image/png" });
  const messageId = await owner.as.mutation(api.messages.sendMessage, {
    channelId,
    content: "",
    attachmentIds: [attachmentId],
  });
  vi.stubEnv("R2_PUBLIC_URL", "https://outpost-cdn.example/");
  try {
    const page = await owner.as.query(api.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const sent = page.page.find((m) => m._id === messageId)!;
    const row = (await t.run((ctx) => ctx.db.get(attachmentId)))!;
    expect(sent.attachments[0].url).toBe(`https://outpost-cdn.example/${row.key}`);
    expect(sent.attachments[0].downloadUrl).toBe(sent.attachments[0].url);
    expect(sent.attachments[0].url).not.toContain("X-Amz-Signature");
  } finally {
    vi.stubEnv("R2_PUBLIC_URL", "");
  }
});

test("deleting a message removes its attachment rows", async () => {
  const { t, owner, channelId } = await setup();
  const { attachmentId } = await owner.as.mutation(api.attachments.createUploadUrl, { channelId, ...png });
  await t.mutation(internal.attachments.markReady, { attachmentId, size: 1024, contentType: "image/png" });
  const messageId = await owner.as.mutation(api.messages.sendMessage, {
    channelId,
    content: "with file",
    attachmentIds: [attachmentId],
  });
  await owner.as.mutation(api.messages.deleteMessage, { messageId });
  expect(await t.run((ctx) => ctx.db.get(attachmentId))).toBeNull();
});

test("reapAbandoned drops only stale pending rows", async () => {
  const { t, owner, channelId } = await setup();
  const fresh = await owner.as.mutation(api.attachments.createUploadUrl, { channelId, ...png });
  const staleId = await t.run(async (ctx) => {
    const row = (await ctx.db.get(fresh.attachmentId))!;
    return await ctx.db.insert("attachments", {
      channelId: row.channelId,
      serverId: row.serverId,
      uploaderId: row.uploaderId,
      key: "stale-key",
      name: row.name,
      contentType: row.contentType,
      size: row.size,
      kind: row.kind,
      status: "pending",
    });
  });
  // Both rows are seconds old: nothing to reap yet.
  await t.mutation(internal.attachments.reapAbandoned, {});
  expect(await t.run((ctx) => ctx.db.get(fresh.attachmentId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(staleId))).not.toBeNull();

  // Two hours later both are past the pending TTL.
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await t.mutation(internal.attachments.reapAbandoned, {});
  } finally {
    vi.useRealTimers();
  }
  expect(await t.run((ctx) => ctx.db.get(fresh.attachmentId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(staleId))).toBeNull();
});

test("messages longer than the Discord limit are rejected on send and edit", async () => {
  const { owner, channelId } = await setup();
  const tooLong = "x".repeat(MAX_MESSAGE_LENGTH + 1);
  await expect(owner.as.mutation(api.messages.sendMessage, { channelId, content: tooLong })).rejects.toThrow(
    /2000 characters/,
  );
  const messageId = await owner.as.mutation(api.messages.sendMessage, {
    channelId,
    content: "x".repeat(MAX_MESSAGE_LENGTH),
  });
  await expect(owner.as.mutation(api.messages.editMessage, { messageId, content: tooLong })).rejects.toThrow(
    /2000 characters/,
  );
});
