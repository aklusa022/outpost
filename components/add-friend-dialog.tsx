"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Dialog, Input } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import { UserPlusIcon } from "@phosphor-icons/react";

export function AddFriendDialog() {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sendFriendRequest = useMutation(api.friends.sendFriendRequest);

  async function handleSubmit() {
    const trimmed = username.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const result = await sendFriendRequest({ username: trimmed });
      toast.success(
        result.autoAccepted
          ? `You're now friends with ${trimmed}!`
          : `Friend request sent to ${trimmed}`,
      );
      setUsername("");
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send friend request",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={<Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Add friend" />}
        aria-label="Add friend"
      >
        <UserPlusIcon className="h-4 w-4" />
      </Dialog.Trigger>
      <Dialog className="p-6">
        <Dialog.Title className="mb-1 text-lg font-semibold">Add friend</Dialog.Title>
        <Dialog.Description className="mb-4 text-sm text-kumo-subtle">
          You can add a friend by their exact username.
        </Dialog.Description>
        <Input
          label="Username"
          id="username"
          placeholder="e.g. alexk"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <div className="mt-6 flex justify-end">
          <Button disabled={!username.trim() || submitting} onClick={handleSubmit}>
            Send friend request
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
