import { v } from "convex/values";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { r2 } from "./r2";
import { getCurrentUserOrThrow, getOrCreateCurrentUser } from "./users";
import { PERMISSIONS, requireChannelPermission } from "./permissions";
import {
  MAX_ATTACHMENT_BYTES,
  TEXT_PREVIEW_MAX_CHARS,
  attachmentKind,
  isBlockedAttachment,
  sanitizeAttachmentName,
} from "./chatLimits";

const URL_TTL_SECONDS = 60 * 60;
/** Pending rows older than this were abandoned mid-upload and get reaped. */
const PENDING_TTL_MS = 60 * 60 * 1000;

export type AttachmentWithUrls = Doc<"attachments"> & {
  url: string;
  downloadUrl: string;
};

/**
 * Hands the client a presigned PUT for one file. The row starts "pending";
 * nothing trusts the declared size/type — `finalizeUpload` re-checks them
 * against the object R2 actually received.
 */
export const createUploadUrl = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const me = await getOrCreateCurrentUser(ctx);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("Channel not found");
    if (channel.type !== "text") throw new Error("Attachments only work in text channels");
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.SEND_MESSAGES);
    await requireChannelPermission(ctx, args.channelId, me._id, PERMISSIONS.ATTACH_FILES);

    const name = sanitizeAttachmentName(args.name);
    const contentType = args.contentType.trim() || "application/octet-stream";
    if (args.size <= 0) throw new Error("File is empty");
    if (args.size > MAX_ATTACHMENT_BYTES) throw new Error("Files must be 10 MB or smaller");
    if (isBlockedAttachment(name, contentType)) {
      throw new Error("That file type isn't allowed");
    }

    const { key, url } = await r2.generateUploadUrl();
    const attachmentId = await ctx.db.insert("attachments", {
      channelId: args.channelId,
      serverId: channel.serverId,
      uploaderId: me._id,
      key,
      name,
      contentType,
      size: args.size,
      kind: attachmentKind(contentType, name),
      status: "pending",
    });
    return { attachmentId, url };
  },
});

export const getPendingOwned = internalQuery({
  args: { attachmentId: v.id("attachments"), clerkId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attachmentId);
    if (!row || row.status !== "pending") return null;
    const uploader = await ctx.db.get(row.uploaderId);
    if (!uploader || uploader.clerkId !== args.clerkId) return null;
    return row;
  },
});

export const markReady = internalMutation({
  args: {
    attachmentId: v.id("attachments"),
    size: v.number(),
    contentType: v.string(),
    textPreview: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attachmentId);
    if (!row || row.status !== "pending") return;
    await ctx.db.patch(args.attachmentId, {
      status: "ready",
      size: args.size,
      contentType: args.contentType,
      kind: attachmentKind(args.contentType, row.name),
      ...(args.textPreview !== undefined ? { textPreview: args.textPreview } : {}),
    });
  },
});

export const discard = internalMutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attachmentId);
    if (!row) return;
    await deleteAttachmentRow(ctx, row);
  },
});

/**
 * Called by the client after its PUT succeeds. Verifies the object that
 * actually landed in R2 (the presigned PUT can't constrain size or type),
 * captures a text preview for `.txt` files, and flips the row to "ready".
 * Anything that fails validation is deleted from R2 along with its row.
 */
export const finalizeUpload = action({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const row: Doc<"attachments"> | null = await ctx.runQuery(
      internal.attachments.getPendingOwned,
      { attachmentId: args.attachmentId, clerkId: identity.subject },
    );
    if (!row) throw new Error("Upload not found");

    const bucket = r2.config.bucket;
    let size: number;
    let contentType: string;
    try {
      const head = await r2.client.send(new HeadObjectCommand({ Bucket: bucket, Key: row.key }));
      size = head.ContentLength ?? 0;
      contentType = (head.ContentType ?? row.contentType).split(";")[0].trim() || row.contentType;
    } catch {
      await ctx.runMutation(internal.attachments.discard, { attachmentId: row._id });
      throw new Error("The upload didn't complete. Please try again.");
    }

    if (size <= 0 || size > MAX_ATTACHMENT_BYTES || isBlockedAttachment(row.name, contentType)) {
      await ctx.runMutation(internal.attachments.discard, { attachmentId: row._id });
      throw new Error(
        size > MAX_ATTACHMENT_BYTES ? "Files must be 10 MB or smaller" : "That file type isn't allowed",
      );
    }

    let textPreview: string | undefined;
    if (attachmentKind(contentType, row.name) === "text") {
      try {
        const obj = await r2.client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: row.key,
            // ~4 bytes per char worst case; more than enough for 2000 chars.
            Range: `bytes=0-${TEXT_PREVIEW_MAX_CHARS * 4 - 1}`,
          }),
        );
        const bytes = await obj.Body?.transformToByteArray();
        if (bytes) {
          const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          textPreview = Array.from(decoded).slice(0, TEXT_PREVIEW_MAX_CHARS).join("");
        }
      } catch {
        // A missing preview is not worth failing the upload over.
      }
    }

    await ctx.runMutation(internal.attachments.markReady, {
      attachmentId: row._id,
      size,
      contentType,
      textPreview,
    });
    return null;
  },
});

/** The uploader removes a file from the composer before sending. */
export const removePending = mutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db.get(args.attachmentId);
    if (!row) return;
    if (row.uploaderId !== me._id) throw new Error("Not your upload");
    if (row.messageId) throw new Error("Attachment already sent");
    await deleteAttachmentRow(ctx, row);
  },
});

/** Cron: drops pending rows (and their objects) that were never finalized. */
export const reapAbandoned = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PENDING_TTL_MS;
    const stale = await ctx.db
      .query("attachments")
      .withIndex("by_status", (q) => q.eq("status", "pending").lt("_creationTime", cutoff))
      .take(100);
    for (const row of stale) await deleteAttachmentRow(ctx, row);
  },
});

// ---------------------------------------------------------------------------
// Helpers used by other modules (plain functions, not registered).

export async function deleteAttachmentRow(ctx: MutationCtx, row: Doc<"attachments">) {
  await ctx.db.delete(row._id);
  // Removes the component's metadata row now and schedules the S3 delete
  // with retries; safe to call for keys the component never synced.
  await r2.deleteObject(ctx, row.key);
}

export async function deleteAttachmentsForMessage(ctx: MutationCtx, messageId: Id<"messages">) {
  const rows = await ctx.db
    .query("attachments")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
  for (const row of rows) await deleteAttachmentRow(ctx, row);
}

export async function deleteAttachmentsForChannel(ctx: MutationCtx, channelId: Id<"channels">) {
  const rows = await ctx.db
    .query("attachments")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  for (const row of rows) await deleteAttachmentRow(ctx, row);
}

/**
 * Attaches view + download URLs.
 *
 * With `R2_PUBLIC_URL` set (the bucket's public origin, i.e. its custom
 * domain — configured per deployment with `convex env set`, never in code)
 * both are the plain, cacheable public URL for the object — no expiry, so a
 * long-open tab never ends up with dead links, and Cloudflare's edge cache
 * serves repeat views. Keys are random UUIDs, so a URL is only reachable by
 * someone who was shown it.
 *
 * Without it (dev) they are presigned S3 URLs; `downloadUrl` then carries a
 * `Content-Disposition: attachment` override so navigating to it saves the
 * file under its original name. The client downloads via fetch+blob either
 * way, so the filename is preserved on both paths.
 */
export async function withUrls(rows: Doc<"attachments">[]): Promise<AttachmentWithUrls[]> {
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (publicBase) {
    return rows.map((row) => {
      const url = `${publicBase}/${row.key}`;
      return { ...row, url, downloadUrl: url };
    });
  }
  return await Promise.all(
    rows.map(async (row) => ({
      ...row,
      url: await r2.getUrl(row.key, { expiresIn: URL_TTL_SECONDS }),
      downloadUrl: await getSignedUrl(
        r2.client,
        new GetObjectCommand({
          Bucket: r2.config.bucket,
          Key: row.key,
          ResponseContentDisposition: contentDisposition(row.name),
          ResponseContentType: row.contentType,
        }),
        { expiresIn: URL_TTL_SECONDS },
      ),
    })),
  );
}

function contentDisposition(name: string): string {
  // ASCII fallback for the quoted form, full UTF-8 name in filename* (RFC 5987).
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
