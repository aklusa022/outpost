"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Dialog, Input, Label } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import { ChatCircleDotsIcon, HashIcon, SpeakerHighIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function CreateChannelDialog({
  serverId,
  categoryId,
  compact,
}: {
  serverId: Id<"servers">;
  categoryId?: Id<"categories">;
  /** Renders as a small icon-only button, for use next to a category header. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [submitting, setSubmitting] = useState(false);
  const createChannel = useMutation(api.channels.createChannel);
  const router = useRouter();

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const channelId = await createChannel({
        serverId,
        categoryId,
        name: trimmed,
        type,
      });
      setName("");
      setType("text");
      setOpen(false);
      router.push(`/app/servers/${serverId}/channels/${channelId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {compact ? (
        <Dialog.Trigger
          render={<Button size="icon" variant="ghost" className="h-6 w-6" aria-label="New channel" />}
          aria-label="New channel"
        >
          <ChatCircleDotsIcon className="h-3.5 w-3.5" />
        </Dialog.Trigger>
      ) : (
        <Dialog.Trigger render={<Button size="sm" variant="secondary" className="gap-1.5" />}>
          <ChatCircleDotsIcon className="h-4 w-4" />
          New Channel
        </Dialog.Trigger>
      )}
      <Dialog size="sm" className="p-6">
        <Dialog.Title className="mb-4 text-lg font-semibold">
          Create {type === "voice" ? "voice" : "text"} channel
        </Dialog.Title>
        <div className="flex flex-col gap-2">
          <Label>Channel type</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("text")}
              className={cn(
                "flex flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm",
                type === "text" ? "border-kumo-brand bg-kumo-tint" : "border-kumo-line",
              )}
            >
              <HashIcon className="h-4 w-4" /> Text
            </button>
            <button
              type="button"
              onClick={() => setType("voice")}
              className={cn(
                "flex flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm",
                type === "voice" ? "border-kumo-brand bg-kumo-tint" : "border-kumo-line",
              )}
            >
              <SpeakerHighIcon className="h-4 w-4" /> Voice
            </button>
          </div>
        </div>
        <div className="mt-4">
          <Input
            label="Channel name"
            id="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={type === "voice" ? "General Voice" : "new-channel"}
          />
        </div>
        <div className="mt-6 flex justify-end">
          <Button disabled={!name.trim() || submitting} onClick={handleSubmit}>
            Create channel
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
