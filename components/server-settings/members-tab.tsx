"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerPermissions } from "@/hooks/use-server-permissions";
import { PERMISSIONS } from "@/convex/permissionFlags";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CaretDownIcon } from "@phosphor-icons/react";

export function MembersTab({ serverId }: { serverId: Id<"servers"> }) {
  const members = useQuery(api.servers.listMembers, { serverId });
  const server = useQuery(api.servers.getServer, { serverId });
  const roles = useQuery(api.roles.listRoles, { serverId });
  const assignRole = useMutation(api.roles.assignRole);
  const unassignRole = useMutation(api.roles.unassignRole);
  const kickMember = useMutation(api.servers.kickMember);
  const banMember = useMutation(api.servers.banMember);
  const permissions = useServerPermissions(serverId);

  const canManageRoles = permissions.can(PERMISSIONS.MANAGE_ROLES);
  const canKick = permissions.can(PERMISSIONS.KICK_MEMBERS);
  const canBan = permissions.can(PERMISSIONS.BAN_MEMBERS);
  const assignableRoles = roles?.filter((r) => !r.isDefault) ?? [];

  async function toggleRole(userId: Id<"users">, roleId: Id<"roles">, has: boolean) {
    try {
      if (has) {
        await unassignRole({ serverId, userId, roleId });
      } else {
        await assignRole({ serverId, userId, roleId });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  return (
    <ScrollArea className="h-full p-1">
      <div className="space-y-2">
        {members?.map((member) =>
          member.user ? (
            <div
              key={member._id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <UserAvatar name={member.user.displayName} imageUrl={member.user.imageUrl} />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {member.user.displayName}
                    {server?.ownerId === member.user._id && (
                      <Badge variant="secondary">Owner</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {member.roles.map((role) => (
                      <Badge key={role._id} variant="outline">
                        {role.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canManageRoles && assignableRoles.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                      Roles <CaretDownIcon className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {assignableRoles.map((role) => {
                        const has = member.roles.some((r) => r._id === role._id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={role._id}
                            checked={has}
                            onCheckedChange={() =>
                              toggleRole(member.user!._id, role._id, has)
                            }
                          >
                            {role.name}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {server?.ownerId !== member.user._id && (
                  <>
                    {canKick && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          kickMember({ serverId, userId: member.user!._id }).catch(
                            (err) =>
                              toast.error(
                                err instanceof Error ? err.message : "Failed to kick",
                              ),
                          )
                        }
                      >
                        Kick
                      </Button>
                    )}
                    {canBan && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          banMember({ serverId, userId: member.user!._id }).catch(
                            (err) =>
                              toast.error(
                                err instanceof Error ? err.message : "Failed to ban",
                              ),
                          )
                        }
                      >
                        Ban
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : null,
        )}
      </div>
    </ScrollArea>
  );
}
