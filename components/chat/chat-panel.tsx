"use client";

import { ReactNode, useState } from "react";
import { toast } from "@/lib/toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@cloudflare/kumo";
import { UserAvatar } from "@/components/user-avatar";
import { PencilIcon, TrashIcon } from "@phosphor-icons/react";

export type ChatMessage = {
  _id: string;
  content: string;
  editedAt?: number;
  _creationTime: number;
  authorId: string;
  author: { _id: string; displayName: string; imageUrl: string } | null;
};

export function ChatPanel({
  header,
  messages,
  hasMore,
  isLoadingMore,
  onLoadMore,
  currentUserId,
  canManageMessages,
  onSend,
  onEdit,
  onDelete,
  placeholder,
}: {
  header: ReactNode;
  messages: ChatMessage[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  canManageMessages?: boolean;
  onSend: (content: string) => Promise<unknown>;
  onEdit: (messageId: string, content: string) => Promise<unknown>;
  onDelete: (messageId: string) => Promise<unknown>;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setDraft("");
    try {
      await onSend(content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      {header}
      <ScrollArea className="flex-1">
        <div className="flex min-h-full flex-col-reverse gap-1 p-4">
          {/*
            `messages` is newest-first (descending), matching the `desc`
            paginated query. This container is `flex-col-reverse`, which
            flips the *visual* order back to oldest-at-top/newest-at-bottom
            while keeping the browser anchored to the bottom by default —
            so we deliberately do NOT reverse the array here.
            `min-h-full` is required for that bottom-anchoring: without it
            the div only grows as tall as its content, so with few messages
            it sits at the top of the (block-level) ScrollArea viewport
            instead of being pushed down to the bottom.
          */}
          {messages.map((message, idx, arr) => {
            // In this descending array, the chronologically-previous
            // (older) message sits at the *next* index.
            const prev = arr[idx + 1];
            const grouped =
              prev && prev.authorId === message.authorId
                ? message._creationTime - prev._creationTime < 5 * 60 * 1000
                : false;
            return (
              <MessageRow
                key={message._id}
                message={message}
                grouped={grouped}
                canEdit={message.authorId === currentUserId}
                canDelete={
                  message.authorId === currentUserId || !!canManageMessages
                }
                onEdit={(content) => onEdit(message._id, content)}
                onDelete={() => onDelete(message._id)}
              />
            );
          })}
          {hasMore && (
            <div className="flex justify-center py-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={isLoadingMore}
                onClick={onLoadMore}
              >
                {isLoadingMore ? "Loading…" : "Load older messages"}
              </Button>
            </div>
          )}
          {messages.length === 0 && !hasMore && (
            <p className="py-8 text-center text-sm text-kumo-subtle">
              No messages yet — say hi!
            </p>
          )}
        </div>
      </ScrollArea>
      <div className="p-4 pt-0">
        <Input
          value={draft}
          disabled={sending}
          placeholder={placeholder ?? "Message…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          className="h-11 w-full rounded-lg"
        />
      </div>
    </div>
  );
}

function MessageRow({
  message,
  grouped,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;
  grouped: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (content: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  async function saveEdit() {
    const content = draft.trim();
    if (!content) return;
    try {
      await onEdit(content);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to edit message");
    }
  }

  return (
    <div
      className={`group flex items-start gap-3 rounded-md px-2 py-1 hover:bg-kumo-tint/50 ${grouped ? "" : "mt-3"}`}
    >
      <div className="w-8 shrink-0">
        {!grouped && (
          <UserAvatar
            name={message.author?.displayName ?? "Unknown"}
            imageUrl={message.author?.imageUrl}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">
              {message.author?.displayName ?? "Unknown user"}
            </span>
            <span className="text-xs text-kumo-subtle">
              {new Date(message._creationTime).toLocaleString()}
            </span>
          </div>
        )}
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="h-8 min-w-0 flex-1"
            />
            <Button size="sm" onClick={saveEdit}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content}
            {message.editedAt && (
              <span className="ml-1 text-[10px] text-kumo-subtle">
                (edited)
              </span>
            )}
          </p>
        )}
      </div>
      {!editing && (canEdit || canDelete) && (
        <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
          {canEdit && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              aria-label="Edit message"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => onDelete()}
              aria-label="Delete message"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
