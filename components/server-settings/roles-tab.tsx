"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { PERMISSIONS } from "@/convex/permissionFlags";
import { Button } from "@/components/ui/button";
import { Field, Input, Checkbox } from "@cloudflare/kumo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";

const PERMISSION_OPTIONS: {
  flag: number;
  label: string;
  description: string;
}[] = [
  {
    flag: PERMISSIONS.VIEW_CHANNELS,
    label: "View Channels",
    description: "See categories and channels in this server.",
  },
  {
    flag: PERMISSIONS.SEND_MESSAGES,
    label: "Send Messages",
    description: "Send messages in text channels.",
  },
  {
    flag: PERMISSIONS.ATTACH_FILES,
    label: "Attach Files",
    description: "Upload images, videos, audio and other files with messages.",
  },
  {
    flag: PERMISSIONS.MANAGE_MESSAGES,
    label: "Manage Messages",
    description: "Delete messages sent by other members.",
  },
  {
    flag: PERMISSIONS.CONNECT,
    label: "Connect",
    description: "Join voice channels.",
  },
  {
    flag: PERMISSIONS.CREATE_INVITE,
    label: "Create Invite",
    description: "Create invite links for this server.",
  },
  {
    flag: PERMISSIONS.MANAGE_CHANNELS,
    label: "Manage Channels",
    description: "Create, rename, move, and delete categories/channels.",
  },
  {
    flag: PERMISSIONS.MANAGE_ROLES,
    label: "Manage Roles",
    description: "Create, edit, and assign roles ranked below your own.",
  },
  {
    flag: PERMISSIONS.MANAGE_SERVER,
    label: "Manage Server",
    description: "Change the server's name and settings.",
  },
  {
    flag: PERMISSIONS.KICK_MEMBERS,
    label: "Kick Members",
    description: "Remove members ranked below you from the server.",
  },
  {
    flag: PERMISSIONS.BAN_MEMBERS,
    label: "Ban Members",
    description: "Ban and unban members ranked below you.",
  },
  {
    flag: PERMISSIONS.ADMINISTRATOR,
    label: "Administrator",
    description: "Grants every permission, bypassing all other checks.",
  },
];

export function RolesTab({ serverId }: { serverId: Id<"servers"> }) {
  const roles = useQuery(api.roles.listRoles, { serverId });
  const [selectedRoleId, setSelectedRoleId] = useState<Id<"roles"> | null>(
    null,
  );
  const createRole = useMutation(api.roles.createRole);

  const selectedRole = roles?.find((r) => r._id === selectedRoleId) ?? null;

  async function handleCreateRole() {
    try {
      const roleId = await createRole({
        serverId,
        name: "new role",
        permissions: 0,
      });
      setSelectedRoleId(roleId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create role");
    }
  }

  return (
    <div className="flex h-full gap-4 p-1">
      <div className="flex w-48 shrink-0 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-kumo-subtle">
            Roles
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={handleCreateRole}
            aria-label="Create role"
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-0.5">
            {roles
              ?.slice()
              .sort((a, b) => b.position - a.position)
              .map((role) => (
                <button
                  key={role._id}
                  onClick={() => setSelectedRoleId(role._id)}
                  className={`rounded-md px-2 py-1.5 text-left text-sm hover:bg-kumo-tint ${
                    selectedRoleId === role._id ? "bg-kumo-tint" : ""
                  }`}
                >
                  {role.name}
                </button>
              ))}
          </div>
        </ScrollArea>
      </div>
      <Separator orientation="vertical" />
      <div className="min-w-0 flex-1">
        {selectedRole ? (
          <RoleEditor role={selectedRole} onDeleted={() => setSelectedRoleId(null)} />
        ) : (
          <p className="p-4 text-sm text-kumo-subtle">
            Select a role on the left, or create a new one.
          </p>
        )}
      </div>
    </div>
  );
}

function RoleEditor({
  role,
  onDeleted,
}: {
  role: Doc<"roles">;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(role.name);
  const updateRole = useMutation(api.roles.updateRole);
  const deleteRole = useMutation(api.roles.deleteRole);

  async function togglePermission(flag: number, checked: boolean) {
    const next = checked ? role.permissions | flag : role.permissions & ~flag;
    try {
      await updateRole({ roleId: role._id, permissions: next });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function saveName() {
    if (name.trim() === role.name) return;
    try {
      await updateRole({ roleId: role._id, name: name.trim() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename role");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete the "${role.name}" role?`)) return;
    try {
      await deleteRole({ roleId: role._id });
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete role");
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 pr-4">
        <Field label="Role name">
          <div className="flex gap-2">
            <Input
              id="role-name"
              value={name}
              disabled={role.isDefault}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              aria-label="Role name"
            />
            {!role.isDefault && (
              <Button size="icon" variant="outline" onClick={handleDelete} aria-label={`Delete ${role.name} role`}>
                <TrashIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Field>
        <div className="space-y-3">
          <span className="text-xs font-semibold uppercase text-kumo-subtle">
            Permissions
          </span>
          {PERMISSION_OPTIONS.map((option) => (
            <label
              key={option.flag}
              className="flex items-start gap-3 rounded-md border p-3"
            >
              <Checkbox
                checked={(role.permissions & option.flag) !== 0}
                onCheckedChange={(checked) =>
                  togglePermission(option.flag, checked === true)
                }
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-kumo-subtle">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
