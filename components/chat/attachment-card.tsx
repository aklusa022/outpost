"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes, TEXT_PREVIEW_MAX_CHARS, type AttachmentKind } from "@/convex/chatLimits";
import {
  DownloadSimpleIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicNoteIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/upload";

export type Attachment = {
  _id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  contentType: string;
  url: string;
  downloadUrl: string;
  textPreview?: string;
};

const KIND_ICON = {
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicNoteIcon,
  text: FileTextIcon,
  file: FileIcon,
} as const;

/**
 * Saves the file under its original name. Stays an anchor so middle-click /
 * "open in new tab" still work; a plain click fetches and saves instead.
 */
function DownloadLink({ attachment, overlay }: { attachment: Attachment; overlay?: boolean }) {
  return (
    <a
      href={attachment.downloadUrl}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void downloadFile(attachment.downloadUrl, attachment.name);
      }}
      aria-label={`Download ${attachment.name}`}
      title="Download"
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kumo-default hover:bg-kumo-tint hover:text-kumo-strong",
        overlay && "absolute right-2 top-2 bg-kumo-base/80 hover:bg-kumo-base",
      )}
    >
      <DownloadSimpleIcon className="h-4 w-4" />
    </a>
  );
}

function CardHeader({ attachment }: { attachment: Attachment }) {
  const Icon = KIND_ICON[attachment.kind];
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Icon className="h-5 w-5 shrink-0 text-kumo-subtle" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attachment.name}</p>
        <p className="text-xs text-kumo-subtle">{formatBytes(attachment.size)}</p>
      </div>
      <DownloadLink attachment={attachment} />
    </div>
  );
}

export function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const [revealed, setRevealed] = useState(false);
  const shell = "relative w-full max-w-md overflow-hidden rounded-lg bg-kumo-elevated ring ring-kumo-line";

  if (attachment.kind === "image" || attachment.kind === "video") {
    if (!revealed) {
      const Icon = KIND_ICON[attachment.kind];
      return (
        <div className={cn(shell, "flex aspect-video flex-col items-center justify-center gap-2 bg-kumo-tint p-4")}>
          <Icon className="h-8 w-8 text-kumo-subtle" />
          <p className="max-w-full truncate text-sm font-medium">{attachment.name}</p>
          <p className="text-xs text-kumo-subtle">{formatBytes(attachment.size)}</p>
          <Button size="sm" variant="secondary" onClick={() => setRevealed(true)}>
            <DownloadSimpleIcon className="h-4 w-4" />
            Download to preview
          </Button>
        </div>
      );
    }
    return (
      <div className={cn(shell, "bg-kumo-canvas")}>
        {attachment.kind === "image" ? (
          // Plain img: the CDN URL is already cacheable, and dev's presigned
          // URLs rotate, which would defeat next/image anyway.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={attachment.url} alt={attachment.name} className="max-h-96 w-full object-contain" />
        ) : (
          <video src={attachment.url} controls preload="metadata" className="max-h-96 w-full" />
        )}
        <DownloadLink attachment={attachment} overlay />
      </div>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <div className={cn(shell, "flex flex-col")}>
        <CardHeader attachment={attachment} />
        <audio src={attachment.url} controls preload="metadata" className="w-full px-3 pb-3" />
      </div>
    );
  }

  if (attachment.kind === "text") {
    const preview = attachment.textPreview ?? "";
    const truncated = preview.length >= TEXT_PREVIEW_MAX_CHARS;
    return (
      <div className={cn(shell, "flex flex-col")}>
        <CardHeader attachment={attachment} />
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-kumo-line px-3 py-2 font-mono text-[13px] leading-5">
          {preview || <span className="text-kumo-subtle">No preview available.</span>}
        </pre>
        {truncated && (
          <p className="border-t border-kumo-line px-3 py-1.5 text-xs text-kumo-subtle">
            Preview limited to the first {TEXT_PREVIEW_MAX_CHARS} characters. Download for the full file.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={shell}>
      <CardHeader attachment={attachment} />
    </div>
  );
}
