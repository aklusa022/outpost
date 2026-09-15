"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Dialog, Input, Tabs } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@phosphor-icons/react";

export function CreateServerDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createServer = useMutation(api.servers.createServer);
  const joinByInvite = useMutation(api.invites.joinByInvite);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const serverId = await createServer({ name: name.trim() });
      setOpen(false);
      setName("");
      router.push(`/app/servers/${serverId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const serverId = await joinByInvite({ code: trimmed });
      setOpen(false);
      setCode("");
      router.push(`/app/servers/${serverId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <Button
            size="icon"
            variant="secondary"
            className="h-12 w-12 rounded-2xl"
            aria-label="Add a server"
          />
        }
        aria-label="Add a server"
      >
        <PlusIcon />
      </Dialog.Trigger>
      <Dialog className="p-6">
        <Dialog.Title className="mb-1 text-lg font-semibold">Add a server</Dialog.Title>
        <Dialog.Description className="mb-4 text-sm text-kumo-subtle">
          Create your own server, or join one with an invite code.
        </Dialog.Description>
        <Tabs
          tabs={[
            { value: "create", label: "Create" },
            { value: "join", label: "Join" },
          ]}
          value={tab}
          onValueChange={(v) => setTab(v as "create" | "join")}
          className="w-full"
        />
        {tab === "create" ? (
          <div className="space-y-4 pt-4">
            <Input
              label="Server name"
              id="server-name"
              placeholder="My Awesome Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex justify-end">
              <Button disabled={!name.trim() || submitting} onClick={handleCreate}>
                Create server
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            <Input
              label="Invite code"
              id="invite-code"
              placeholder="e.g. aB3xY9zQ"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            <div className="flex justify-end">
              <Button disabled={!code.trim() || submitting} onClick={handleJoin}>
                Join server
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Dialog.Root>
  );
}
