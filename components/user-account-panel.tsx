"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { UserAvatar } from "@/components/user-avatar";
import { AccountSettingsDialog } from "@/components/account-settings-dialog";
import { Tooltip } from "@cloudflare/kumo";
import { GearIcon } from "@phosphor-icons/react";

export function UserAccountPanel() {
  const user = useQuery(api.users.getCurrentUser);
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <div
        className="h-12 w-12 animate-pulse rounded-2xl bg-kumo-fill"
        aria-hidden
      />
    );
  }

  return (
    <>
      <Tooltip
        side="right"
        content={
          <span className="flex items-center gap-1">
            <GearIcon className="h-3 w-3" /> {user.displayName}
          </span>
        }
        render={
          <button
            onClick={() => setOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-kumo-fill text-kumo-subtle transition-all hover:rounded-xl hover:bg-kumo-brand hover:text-white"
            aria-label="Account settings"
          />
        }
      >
        <UserAvatar name={user.displayName} imageUrl={user.imageUrl} className="h-8 w-8" />
      </Tooltip>
      <AccountSettingsDialog user={user} open={open} onOpenChange={setOpen} />
    </>
  );
}
