"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CopyIcon, TrashIcon } from "@phosphor-icons/react";

export function InvitesTab({ serverId }: { serverId: Id<"servers"> }) {
  const invites = useQuery(api.invites.listServerInvites, { serverId });
  const createInvite = useMutation(api.invites.createInvite);
  const revokeInvite = useMutation(api.invites.revokeInvite);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createInvite({ serverId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setCreating(false);
    }
  }

  function copyLink(code: string) {
    const url = `${window.location.origin}/invite/${code}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }

  return (
    <div className="space-y-3 p-1">
      <Button size="sm" disabled={creating} onClick={handleCreate}>
        Create invite
      </Button>
      <ScrollArea className="h-[400px]">
        <div className="space-y-2">
          {invites?.length === 0 && (
            <p className="text-sm text-kumo-subtle">No active invites.</p>
          )}
          {invites?.map((invite) => (
            <div
              key={invite._id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div>
                <div className="font-mono text-sm">{invite.code}</div>
                <div className="text-xs text-kumo-subtle">
                  {invite.uses} use{invite.uses === 1 ? "" : "s"}
                  {invite.maxUses ? ` / ${invite.maxUses}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => copyLink(invite.code)}
                  aria-label="Copy invite link"
                >
                  <CopyIcon className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => revokeInvite({ inviteId: invite._id })}
                  aria-label="Revoke invite"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
