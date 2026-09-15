"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { Dialog, Input, Select } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/user-avatar";
import { SignOutIcon, ShieldCheckIcon, XIcon } from "@phosphor-icons/react";

export function AccountSettingsDialog({
  user,
  open,
  onOpenChange,
}: {
  user: Doc<"users">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [saving, setSaving] = useState(false);
  const updateProfile = useMutation(api.users.updateProfile);
  const setStatus = useMutation(api.users.setStatus);
  const clerk = useClerk();

  const STATUS_OPTIONS = [
    { value: "online", label: "Online" },
    { value: "idle", label: "Idle" },
    { value: "dnd", label: "Do Not Disturb" },
    { value: "invisible", label: "Invisible" },
  ] as const;

  useEffect(() => {
    if (open) {
      setDisplayName(user.displayName);
      setUsername(user.username);
    }
  }, [open, user]);

  const dirty = displayName.trim() !== user.displayName || username.trim() !== user.username;

  async function handleSave() {
    setSaving(true);
    try {
      await updateProfile({ displayName, username });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="lg" className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-lg font-semibold">My Account</Dialog.Title>
            <Dialog.Description className="text-sm text-kumo-subtle">
              Manage how you appear across Outpost.
            </Dialog.Description>
          </div>
          <Dialog.Close
            aria-label="Close"
            render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}
          >
            <XIcon />
          </Dialog.Close>
        </div>

        <div className="flex items-center gap-3">
          <UserAvatar name={displayName || user.displayName} imageUrl={user.imageUrl} className="h-14 w-14" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.displayName}</p>
            <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
          </div>
        </div>

        <div className="space-y-3">
          <Input
            label="Display name"
            id="account-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={32}
          />
          <Input
            label="Username"
            id="account-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            description="Friends add you by this exact username."
          />
          <Select
            label="Status"
            className="w-full min-w-0"
            items={STATUS_OPTIONS}
            value={user.status ?? "online"}
            onValueChange={(v) =>
              v && setStatus({ status: v as "online" | "idle" | "dnd" | "invisible" })
            }
          />
          <Button disabled={!dirty || saving} onClick={handleSave} className="w-full mt-2 mb-2">
            Save changes
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <Button
            icon={<ShieldCheckIcon/>}
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => clerk.openUserProfile()}
          >
            Manage email, password &amp; security
          </Button>
          <Button
            icon={<SignOutIcon/>}
            variant="outline"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive"
            onClick={() => clerk.signOut()}
          >

            Sign out
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
