"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/lib/toast";
import { uploadToR2 } from "@/lib/upload";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentKind,
  isBlockedAttachment,
  type AttachmentKind,
} from "@/convex/chatLimits";

export type PendingAttachment = {
  localId: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  /** Object URL for image thumbnails in the composer. */
  previewUrl?: string;
  attachmentId?: Id<"attachments">;
  /** 0..1 */
  progress: number;
  status: "uploading" | "ready";
};

export type AttachmentUploader = {
  items: PendingAttachment[];
  add: (files: FileList | File[]) => void;
  remove: (localId: string) => void;
  /** Forget everything without deleting server rows (after a successful send). */
  clear: () => void;
  readyIds: Id<"attachments">[];
  busy: boolean;
};

/**
 * Owns the composer's pending attachments for one channel: uploads each
 * picked file straight to R2 (presigned PUT from `createUploadUrl`), then
 * asks the backend to verify and finalize it. Switching channels discards
 * whatever was pending.
 */
export function useAttachmentUploads(channelId: Id<"channels">): AttachmentUploader {
  const createUploadUrl = useMutation(api.attachments.createUploadUrl);
  const finalizeUpload = useAction(api.attachments.finalizeUpload);
  const removePending = useMutation(api.attachments.removePending);
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const discardAll = useCallback(() => {
    for (const item of itemsRef.current) {
      controllers.current.get(item.localId)?.abort();
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.attachmentId) void removePending({ attachmentId: item.attachmentId }).catch(() => {});
    }
    controllers.current.clear();
    setItems([]);
  }, [removePending]);

  // Pending files belong to the channel they were picked in.
  useEffect(() => discardAll, [channelId, discardAll]);

  const patch = useCallback((localId: string, update: Partial<PendingAttachment>) => {
    setItems((prev) => prev.map((i) => (i.localId === localId ? { ...i, ...update } : i)));
  }, []);

  const drop = useCallback((localId: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((i) => i.localId !== localId);
    });
    controllers.current.delete(localId);
  }, []);

  const add = useCallback(
    (input: FileList | File[]) => {
      const files = Array.from(input);
      if (files.length === 0) return;
      const room = MAX_ATTACHMENTS_PER_MESSAGE - itemsRef.current.length;
      if (files.length > room) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
        return;
      }
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error({ title: "File too large", description: `${file.name} is over 10 MB.` });
          continue;
        }
        if (file.size === 0) {
          toast.error({ title: "Empty file", description: `${file.name} has no content.` });
          continue;
        }
        if (isBlockedAttachment(file.name, file.type)) {
          toast.error({ title: "File type not allowed", description: file.name });
          continue;
        }
        const localId = crypto.randomUUID();
        const kind = attachmentKind(file.type, file.name);
        const controller = new AbortController();
        controllers.current.set(localId, controller);
        setItems((prev) => [
          ...prev,
          {
            localId,
            name: file.name,
            size: file.size,
            kind,
            previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
            progress: 0,
            status: "uploading",
          },
        ]);

        void (async () => {
          let attachmentId: Id<"attachments"> | undefined;
          try {
            const res = await createUploadUrl({
              channelId,
              name: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
            });
            attachmentId = res.attachmentId;
            patch(localId, { attachmentId });
            await uploadToR2(res.url, file, {
              signal: controller.signal,
              onProgress: (loaded, total) => patch(localId, { progress: total ? loaded / total : 0 }),
            });
            if (controller.signal.aborted) return;
            await finalizeUpload({ attachmentId });
            if (controller.signal.aborted) return;
            patch(localId, { status: "ready", progress: 1 });
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            toast.error({
              title: "Upload failed",
              description: err instanceof Error ? err.message : file.name,
            });
            drop(localId);
            if (attachmentId) void removePending({ attachmentId }).catch(() => {});
          }
        })();
      }
    },
    [channelId, createUploadUrl, finalizeUpload, removePending, patch, drop],
  );

  const remove = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((i) => i.localId === localId);
      controllers.current.get(localId)?.abort();
      drop(localId);
      if (item?.attachmentId) void removePending({ attachmentId: item.attachmentId }).catch(() => {});
    },
    [drop, removePending],
  );

  const clear = useCallback(() => {
    for (const item of itemsRef.current) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    controllers.current.clear();
    setItems([]);
  }, []);

  return useMemo(
    () => ({
      items,
      add,
      remove,
      clear,
      readyIds: items.filter((i) => i.status === "ready" && i.attachmentId).map((i) => i.attachmentId!),
      busy: items.some((i) => i.status === "uploading"),
    }),
    [items, add, remove, clear],
  );
}
