import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

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
  const owner = await createUser(t, "owner", "Owner");
  const serverId = await owner.as.mutation(api.servers.createServer, { name: "Test Server" });
  const categories = await owner.as.query(api.categories.listCategories, { serverId });
  const text = categories.find((c) => c.name === "Text Channels")!;
  const voice = categories.find((c) => c.name === "Voice Channels")!;
  return { t, owner, serverId, text, voice };
}

async function orderIn(
  owner: Awaited<ReturnType<typeof createUser>>,
  serverId: Id<"servers">,
  categoryId: Id<"categories">,
) {
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  return channels
    .filter((c) => c.categoryId === categoryId)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ name: c.name, position: c.position }));
}

test("new servers seed text and voice categories, each with a general channel", async () => {
  const { owner, serverId, text, voice } = await setup();
  expect(await orderIn(owner, serverId, text._id)).toEqual([{ name: "general", position: 0 }]);
  expect(await orderIn(owner, serverId, voice._id)).toEqual([{ name: "general", position: 0 }]);
});

test("createChannel requires a category on the same server and appends within it", async () => {
  const { t, owner, serverId, text } = await setup();
  await owner.as.mutation(api.channels.createChannel, { serverId, categoryId: text._id, name: "random" });
  expect(await orderIn(owner, serverId, text._id)).toEqual([
    { name: "general", position: 0 },
    { name: "random", position: 1 },
  ]);

  const other = await createUser(t, "other", "Other");
  const otherServer = await other.as.mutation(api.servers.createServer, { name: "Other" });
  await expect(
    owner.as.mutation(api.channels.createChannel, { serverId: otherServer, categoryId: text._id, name: "x" }),
  ).rejects.toThrow();
});

test("moveChannel reorders within a category and renumbers densely", async () => {
  const { owner, serverId, text } = await setup();
  for (const name of ["b", "c", "d"]) {
    await owner.as.mutation(api.channels.createChannel, { serverId, categoryId: text._id, name });
  }
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  const d = channels.find((c) => c.name === "d")!;
  await owner.as.mutation(api.channels.moveChannel, { channelId: d._id, categoryId: text._id, index: 1 });
  expect(await orderIn(owner, serverId, text._id)).toEqual([
    { name: "general", position: 0 },
    { name: "d", position: 1 },
    { name: "b", position: 2 },
    { name: "c", position: 3 },
  ]);
});

test("moveChannel across categories renumbers both source and target", async () => {
  const { owner, serverId, text, voice } = await setup();
  await owner.as.mutation(api.channels.createChannel, { serverId, categoryId: text._id, name: "random" });
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  const general = channels.find((c) => c.name === "general" && c.categoryId === text._id)!;
  await owner.as.mutation(api.channels.moveChannel, { channelId: general._id, categoryId: voice._id, index: 0 });
  expect(await orderIn(owner, serverId, text._id)).toEqual([{ name: "random", position: 0 }]);
  expect(await orderIn(owner, serverId, voice._id)).toEqual([
    { name: "general", position: 0 },
    { name: "general", position: 1 },
  ]);
  const moved = (await owner.as.query(api.channels.listChannels, { serverId })).find((c) => c._id === general._id)!;
  expect(moved.categoryId).toBe(voice._id);
});

test("moveChannel needs Manage Channels", async () => {
  const { t, owner, serverId, text } = await setup();
  const member = await createUser(t, "member", "Member");
  const inviteId = await owner.as.mutation(api.invites.createInvite, { serverId });
  const invites = await owner.as.query(api.invites.listServerInvites, { serverId });
  await member.as.mutation(api.invites.joinByInvite, { code: invites.find((i) => i._id === inviteId)!.code });
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  await expect(
    member.as.mutation(api.channels.moveChannel, { channelId: channels[0]._id, categoryId: text._id, index: 0 }),
  ).rejects.toThrow(/permission/);
});

test("reorderCategory renumbers categories", async () => {
  const { owner, serverId, text, voice } = await setup();
  const extra = await owner.as.mutation(api.categories.createCategory, { serverId, name: "Extra" });
  await owner.as.mutation(api.categories.reorderCategory, { categoryId: extra, index: 0 });
  const categories = await owner.as.query(api.categories.listCategories, { serverId });
  expect(categories.map((c) => [c.name, c.position])).toEqual([
    ["Extra", 0],
    ["Text Channels", 1],
    ["Voice Channels", 2],
  ]);
  expect(categories.find((c) => c._id === text._id)!.position).toBe(1);
  expect(categories.find((c) => c._id === voice._id)!.position).toBe(2);
});

test("the last category can't be deleted; deleting one cascades its channels' overrides", async () => {
  const { owner, serverId, text, voice } = await setup();
  const channels = await owner.as.query(api.channels.listChannels, { serverId });
  const voiceGeneral = channels.find((c) => c.categoryId === voice._id)!;
  const roles = await owner.as.query(api.roles.listRoles, { serverId });
  await owner.as.mutation(api.channelPermissions.setChannelOverride, {
    channelId: voiceGeneral._id,
    targetType: "role",
    targetId: roles[0]._id,
    allow: 0,
    deny: 1,
  });
  await owner.as.mutation(api.categories.deleteCategory, { categoryId: voice._id });
  const remaining = await owner.as.query(api.channels.listChannels, { serverId });
  expect(remaining.some((c) => c._id === voiceGeneral._id)).toBe(false);
  const overrides = await owner.as.query(api.channelPermissions.listChannelOverrides, {
    channelId: voiceGeneral._id,
  }).catch(() => []);
  expect(overrides).toEqual([]);

  await expect(
    owner.as.mutation(api.categories.deleteCategory, { categoryId: text._id }),
  ).rejects.toThrow(/at least one category/);
});

test("backfillCategories is a no-op once every channel has a category", async () => {
  const { t } = await setup();
  const result = await t.mutation(internal.channels.backfillCategories, {});
  expect(result).toEqual({ moved: 0 });
});
