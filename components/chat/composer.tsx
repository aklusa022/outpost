"use client";

import { useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { InputArea, Meter } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import type { AttachmentUploader, PendingAttachment } from "@/hooks/use-attachment-uploads";
import { MAX_MESSAGE_LENGTH, formatBytes } from "@/convex/chatLimits";
import {
  FileIcon,
  FileTextIcon,
  MusicNoteIcon,
  PlusCircleIcon,
  UploadSimpleIcon,
  VideoIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** Show the remaining-characters counter once the draft gets this close to the cap. */
const COUNTER_THRESHOLD = 200;

const CHIP_ICON = {
  video: VideoIcon,
  audio: MusicNoteIcon,
  text: FileTextIcon,
  file: FileIcon,
} as const;

function AttachmentChip({ item, onRemove }: { item: PendingAttachment; onRemove: () => void }) {
  const Icon = item.kind === "image" ? null : CHIP_ICON[item.kind];
  return (
    <div className="relative flex w-40 shrink-0 flex-col gap-1.5 rounded-md bg-kumo-elevated p-2 ring ring-kumo-line">
      <div className="flex h-20 items-center justify-center overflow-hidden rounded bg-kumo-tint">
        {item.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : Icon ? (
          <Icon className="h-8 w-8 text-kumo-subtle" />
        ) : null}
      </div>
      <p className="truncate text-xs font-medium" title={item.name}>
        {item.name}
      </p>
      {item.status === "uploading" ? (
        <Meter label="Uploading" value={Math.round(item.progress * 100)} className="text-[11px]" />
      ) : (
        <p className="text-[11px] text-kumo-subtle">{formatBytes(item.size)}</p>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.name}`}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-kumo-danger text-white hover:opacity-90"
      >
        <XIcon className="h-3 w-3" weight="bold" />
      </button>
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  uploader,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** When present, the composer shows the "+" attach menu and pending files. */
  uploader?: AttachmentUploader;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const remaining = MAX_MESSAGE_LENGTH - value.length;

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!uploader) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      uploader.add(files);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!uploader) return;
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) uploader.add(e.dataTransfer.files);
  }

  return (
    <div
      className="rounded-lg bg-kumo-control ring ring-kumo-line focus-within:ring-kumo-brand"
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={uploader ? (e) => e.preventDefault() : undefined}
    >
      {uploader && uploader.items.length > 0 && (
        <div className="flex gap-3 overflow-x-auto border-b border-kumo-line p-3 pt-3.5">
          {uploader.items.map((item) => (
            <AttachmentChip key={item.localId} item={item} onRemove={() => uploader.remove(item.localId)} />
          ))}
        </div>
      )}
      <div className="flex items-end gap-1 px-2">
        {uploader && (
          <>
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Add attachment"
                    className="my-1.5 h-8 w-8 shrink-0 rounded-full text-kumo-subtle hover:text-kumo-strong"
                  />
                }
              >
                <PlusCircleIcon className="h-6 w-6" weight="fill" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" className="w-48">
                <DropdownMenu.Item icon={UploadSimpleIcon} onClick={() => fileInput.current?.click()}>
                  Attach file
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) uploader.add(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
        <InputArea
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={MAX_MESSAGE_LENGTH}
          autoResize
          minRows={1}
          maxRows={8}
          aria-label="Message"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-11 flex-1 resize-none border-0! bg-transparent! px-1! py-3! text-[15px]! shadow-none! ring-0! outline-none! focus:ring-0! focus-visible:ring-0!"
        />
        {remaining <= COUNTER_THRESHOLD && (
          <span
            className={cn(
              "mb-3 shrink-0 text-xs tabular-nums",
              remaining <= 0 ? "text-kumo-danger" : "text-kumo-subtle",
            )}
          >
            {remaining}
          </span>
        )}
      </div>
    </div>
  );
}
