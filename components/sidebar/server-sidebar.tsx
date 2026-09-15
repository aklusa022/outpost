"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ServerSettingsDialog } from "@/components/server-settings/server-settings-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { useServerPermissions } from "@/hooks/use-server-permissions";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { PERMISSIONS } from "@/convex/permissionFlags";
import { cn } from "@/lib/utils";
import {
  CaretDownIcon,
  HashIcon,
  GearIcon,
  UserPlusIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import { useState, type MouseEvent } from "react";

export function ServerSidebar({ serverId }: { serverId: Id<"servers"> }) {
  const server = useQuery(api.servers.getServer, { serverId });
  const categories = useQuery(api.categories.listCategories, { serverId });
  const channels = useQuery(api.channels.listChannels, { serverId });
  const voiceParticipants = useQuery(api.voiceChannels.listVoiceParticipants, { serverId });
  const permissions = useServerPermissions(serverId);
  const leaveServer = useMutation(api.servers.leaveServer);
  const deleteServer = useMutation(api.servers.deleteServer);
  const pathname = usePathname();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("overview");

  if (!server || categories === undefined || channels === undefined) {
    return <div className="w-60 shrink-0 border-r bg-kumo-elevated" />;
  }

  const uncategorized = channels.filter((c) => !c.categoryId);
  const canManageChannels = permissions.can(PERMISSIONS.MANAGE_CHANNELS);
  const canOpenSettings =
    permissions.isOwner ||
    permissions.can(PERMISSIONS.MANAGE_SERVER) ||
    permissions.can(PERMISSIONS.MANAGE_ROLES) ||
    canManageChannels;

  function openSettings(tab: string) {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  async function handleLeaveOrDelete() {
    try {
      if (permissions.isOwner) {
        if (!confirm(`Delete "${server?.name}"? This can't be undone.`)) return;
        await deleteServer({ serverId });
      } else {
        await leaveServer({ serverId });
      }
      router.push("/app/friends");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r bg-kumo-elevated">
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <button className="flex h-12 shrink-0 items-center justify-between border-b px-4 font-semibold shadow-sm hover:bg-kumo-tint/50" />
          }
        >
          <span className="truncate">{server.name}</span>
          <CaretDownIcon className="h-4 w-4 shrink-0 text-kumo-subtle" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" className="w-56">
          <DropdownMenu.Item icon={UserPlusIcon} onClick={() => openSettings("invites")}>
            Invite People
          </DropdownMenu.Item>
          {canOpenSettings && (
            <DropdownMenu.Item icon={GearIcon} onClick={() => openSettings("channels")}>
              Server Settings
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item variant="danger" onClick={handleLeaveOrDelete}>
            {permissions.isOwner ? "Delete Server" : "Leave Server"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>

      <ScrollArea className="flex-1 px-2 py-2">
        <div className="flex flex-col gap-3">
          {uncategorized.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {uncategorized
                .sort((a, b) => a.position - b.position)
                .map((channel) => (
                  <ChannelLink
                    key={channel._id}
                    serverId={serverId}
                    channel={channel}
                    active={
                      pathname ===
                      `/app/servers/${serverId}/channels/${channel._id}`
                    }
                    participants={
                      voiceParticipants?.filter(
                        (p) => p.channelId === channel._id,
                      ) ?? []
                    }
                  />
                ))}
            </div>
          )}
          {categories
            .sort((a, b) => a.position - b.position)
            .map((category) => (
              <div key={category._id}>
                <div className="px-1 text-xs font-semibold uppercase text-kumo-subtle">
                  <span className="truncate">{category.name}</span>
                </div>
                <div className="mt-1 flex flex-col gap-0.5">
                  {channels
                    .filter((c) => c.categoryId === category._id)
                    .sort((a, b) => a.position - b.position)
                    .map((channel) => (
                      <ChannelLink
                        key={channel._id}
                        serverId={serverId}
                        channel={channel}
                        participants={
                          voiceParticipants?.filter(
                            (p) => p.channelId === channel._id,
                          ) ?? []
                        }
                        active={
                          pathname ===
                          `/app/servers/${serverId}/channels/${channel._id}`
                        }
                      />
                    ))}
                </div>
              </div>
            ))}
          {canManageChannels && (
            <button
              onClick={() => openSettings("channels")}
              className="px-1 text-left text-xs font-medium text-kumo-subtle hover:text-kumo-default hover:underline"
            >
              + Add a category or channel
            </button>
          )}
        </div>
      </ScrollArea>

      <ServerSettingsDialog
        serverId={serverId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        defaultTab={settingsTab}
      />
    </div>
  );
}

function ChannelLink({
  serverId,
  channel,
  active,
  participants,
}: {
  serverId: Id<"servers">;
  channel: { _id: Id<"channels">; name: string; type: "text" | "voice" };
  active: boolean;
  participants: { userId: Id<"users">; user: { displayName: string; imageUrl: string } | null }[];
}) {
  const router = useRouter();
  const { join, activeChannelId, status, warmToken } = useVoiceCall();

  async function handleClick(e: MouseEvent) {
    if (channel.type !== "voice") return;
    e.preventDefault();
    router.push(`/app/servers/${serverId}/channels/${channel._id}`);
    if (activeChannelId === channel._id && status !== "idle") return;
    try {
      await join(channel._id, serverId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join the call");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Link
        href={`/app/servers/${serverId}/channels/${channel._id}`}
        prefetch={false}
        onClick={handleClick}
        // Hovering a voice channel fetches (and caches) its participant token
        // so the click-to-join path skips the server round trip.
        onMouseEnter={channel.type === "voice" ? () => warmToken(channel._id) : undefined}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-strong",
          active && "bg-kumo-tint text-kumo-strong",
        )}
      >
        {channel.type === "voice" ? (
          <SpeakerHighIcon className="h-4 w-4 shrink-0" />
        ) : (
          <HashIcon className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{channel.name}</span>
      </Link>
      {channel.type === "voice" && participants.length > 0 && (
        <div className="flex flex-col gap-0.5 pl-6">
          {participants.map((p) => (
            <div key={p.userId} className="flex items-center gap-1.5 py-0.5">
              <UserAvatar
                name={p.user?.displayName ?? "?"}
                imageUrl={p.user?.imageUrl}
                className="h-5 w-5"
              />
              <span className="truncate text-xs text-kumo-subtle">
                {p.user?.displayName ?? "Unknown"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
