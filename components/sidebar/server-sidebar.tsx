"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  DotsSixVerticalIcon,
  HashIcon,
  GearIcon,
  UserPlusIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

type Channel = {
  _id: Id<"channels">;
  name: string;
  type: "text" | "voice";
  categoryId?: Id<"categories">;
  position: number;
};
type Participant = {
  channelId: Id<"channels">;
  userId: Id<"users">;
  user: { displayName: string; imageUrl: string } | null;
};
type TreeCategory = {
  _id: Id<"categories">;
  name: string;
  channels: Channel[];
};

// dnd-kit ids: "cat:<id>" = sortable category block, "drop:<id>" = the
// channel list inside a category (so empty categories accept drops),
// "ch:<id>" = sortable channel row.
const catId = (id: Id<"categories">) => `cat:${id}`;
const dropId = (id: Id<"categories">) => `drop:${id}`;
const chId = (id: Id<"channels">) => `ch:${id}`;
const parseId = (id: UniqueIdentifier) => {
  const s = String(id);
  const i = s.indexOf(":");
  return { kind: s.slice(0, i) as "cat" | "drop" | "ch", id: s.slice(i + 1) };
};

function buildTree(
  categories: { _id: Id<"categories">; name: string; position: number }[],
  channels: Channel[],
): TreeCategory[] {
  return [...categories]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      _id: c._id,
      name: c.name,
      channels: channels
        .filter((ch) => ch.categoryId === c._id)
        .sort((a, b) => a.position - b.position),
    }));
}

function containerOf(tree: TreeCategory[], id: UniqueIdentifier): Id<"categories"> | undefined {
  const { kind, id: raw } = parseId(id);
  if (kind === "cat" || kind === "drop") return raw as Id<"categories">;
  return tree.find((c) => c.channels.some((ch) => ch._id === raw))?._id;
}

export function ServerSidebar({ serverId }: { serverId: Id<"servers"> }) {
  const server = useQuery(api.servers.getServer, { serverId });
  const categories = useQuery(api.categories.listCategories, { serverId });
  const channels = useQuery(api.channels.listChannels, { serverId });
  const voiceParticipants = useQuery(api.voiceChannels.listVoiceParticipants, { serverId });
  const permissions = useServerPermissions(serverId);
  const leaveServer = useMutation(api.servers.leaveServer);
  const deleteServer = useMutation(api.servers.deleteServer);
  const moveChannel = useMutation(api.channels.moveChannel);
  const reorderCategory = useMutation(api.categories.reorderCategory);
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("overview");

  const serverTree = useMemo(
    () => (categories && channels ? buildTree(categories, channels) : []),
    [categories, channels],
  );
  // Optimistic copy of the tree while a drag is in flight (and until the
  // next server result replaces it).
  const [localTree, setLocalTree] = useState<TreeCategory[] | null>(null);
  useEffect(() => setLocalTree(null), [serverTree]);
  const tree = localTree ?? serverTree;
  const [active, setActive] = useState<UniqueIdentifier | null>(null);

  const canManageChannels = permissions.can(PERMISSIONS.MANAGE_CHANNELS);
  const sensors = useSensors(
    // A small distance threshold keeps plain clicks (navigate / join voice)
    // from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!server || categories === undefined || channels === undefined) {
    return <div className="w-60 shrink-0 border-r bg-kumo-elevated" />;
  }

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

  function handleDragStart({ active }: DragStartEvent) {
    setActive(active.id);
    setLocalTree(tree);
  }

  // Moves a channel between categories while hovering, so the list opens a
  // slot where it will land (standard dnd-kit multi-container pattern).
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over || parseId(active.id).kind !== "ch") return;
    const from = containerOf(tree, active.id);
    const to = containerOf(tree, over.id);
    if (!from || !to || from === to) return;
    const channelId = parseId(active.id).id as Id<"channels">;
    setLocalTree((prev) => {
      const t = prev ?? tree;
      const source = t.find((c) => c._id === from)!;
      const target = t.find((c) => c._id === to)!;
      const channel = source.channels.find((c) => c._id === channelId);
      if (!channel) return t;
      let index = target.channels.length;
      if (parseId(over.id).kind === "ch") {
        const overIndex = target.channels.findIndex((c) => c._id === parseId(over.id).id);
        const overRect = over.rect;
        const activeRect = active.rect.current.translated;
        const below = activeRect && overRect ? activeRect.top > overRect.top + overRect.height / 2 : false;
        index = overIndex + (below ? 1 : 0);
      }
      return t.map((c) => {
        if (c._id === from) return { ...c, channels: c.channels.filter((ch) => ch._id !== channelId) };
        if (c._id === to) {
          const next = [...c.channels];
          next.splice(index, 0, { ...channel, categoryId: to });
          return { ...c, channels: next };
        }
        return c;
      });
    });
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setActive(null);
    if (!over) {
      setLocalTree(null);
      return;
    }
    const kind = parseId(active.id).kind;
    try {
      if (kind === "cat") {
        // Whatever we landed on (a category block, or a channel/drop zone
        // inside one), resolve it to the category it belongs to.
        const overCategory = containerOf(tree, over.id);
        const ids = tree.map((c) => c._id);
        const oldIndex = ids.indexOf(parseId(active.id).id as Id<"categories">);
        const newIndex = overCategory ? ids.indexOf(overCategory) : -1;
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          setLocalTree(null);
          return;
        }
        setLocalTree(arrayMove(tree, oldIndex, newIndex));
        await reorderCategory({ categoryId: ids[oldIndex], index: newIndex });
        return;
      }
      const channelId = parseId(active.id).id as Id<"channels">;
      const container = containerOf(tree, active.id);
      if (!container) return;
      const category = tree.find((c) => c._id === container)!;
      let ordered = category.channels;
      if (parseId(over.id).kind === "ch" && containerOf(tree, over.id) === container) {
        const oldIndex = ordered.findIndex((c) => c._id === channelId);
        const newIndex = ordered.findIndex((c) => c._id === parseId(over.id).id);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          ordered = arrayMove(ordered, oldIndex, newIndex);
          setLocalTree(tree.map((c) => (c._id === container ? { ...c, channels: ordered } : c)));
        }
      }
      const index = ordered.findIndex((c) => c._id === channelId);
      // Nothing to persist if the server already has it here.
      const serverCategory = serverTree.find((c) => c.channels.some((ch) => ch._id === channelId));
      const serverIndex = serverCategory?.channels.findIndex((c) => c._id === channelId);
      if (serverCategory?._id === container && serverIndex === index) return;
      await moveChannel({ channelId, categoryId: container, index });
    } catch (err) {
      setLocalTree(null);
      toast.error(err instanceof Error ? err.message : "Couldn't move that");
    }
  }

  const activeParsed = active ? parseId(active) : null;
  const activeCategory =
    activeParsed?.kind === "cat" ? tree.find((c) => c._id === activeParsed.id) : undefined;
  const activeChannel =
    activeParsed?.kind === "ch"
      ? tree.flatMap((c) => c.channels).find((c) => c._id === activeParsed.id)
      : undefined;

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r bg-kumo-elevated">
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <button className="flex h-12 shrink-0 items-center justify-between border-b px-4 text-[15px] font-semibold shadow-sm hover:bg-kumo-tint/50" />
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActive(null);
            setLocalTree(null);
          }}
        >
          <SortableContext items={tree.map((c) => catId(c._id))} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {tree.map((category) => (
                <CategoryBlock
                  key={category._id}
                  category={category}
                  serverId={serverId}
                  canManage={canManageChannels}
                  participants={voiceParticipants ?? []}
                  draggingCategory={activeParsed?.kind === "cat"}
                />
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
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeCategory ? (
              <div className="rounded-md bg-kumo-elevated px-1 text-xs font-semibold uppercase text-kumo-default shadow-lg ring ring-kumo-line">
                {activeCategory.name}
              </div>
            ) : activeChannel ? (
              <div className="flex items-center gap-1.5 rounded-md bg-kumo-tint px-2 py-1.5 text-[15px] font-medium text-kumo-strong shadow-lg ring ring-kumo-line">
                {activeChannel.type === "voice" ? (
                  <SpeakerHighIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <HashIcon className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{activeChannel.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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

function CategoryBlock({
  category,
  serverId,
  canManage,
  participants,
  draggingCategory,
}: {
  category: TreeCategory;
  serverId: Id<"servers">;
  canManage: boolean;
  participants: Participant[];
  draggingCategory: boolean;
}) {
  const pathname = usePathname();
  const sortable = useSortable({ id: catId(category._id), disabled: !canManage, data: { kind: "cat" } });
  const droppable = useDroppable({ id: dropId(category._id), disabled: !canManage || draggingCategory });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(sortable.isDragging && "opacity-40")}
    >
      <div
        {...sortable.attributes}
        {...sortable.listeners}
        className={cn(
          "group/cat flex items-center gap-1 px-1 text-xs font-semibold uppercase text-kumo-subtle",
          canManage && "cursor-grab hover:text-kumo-default active:cursor-grabbing",
        )}
      >
        <span className="truncate">{category.name}</span>
        {canManage && (
          <DotsSixVerticalIcon className="ml-auto h-3.5 w-3.5 shrink-0 opacity-0 group-hover/cat:opacity-100" />
        )}
      </div>
      <SortableContext
        items={category.channels.map((c) => chId(c._id))}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={droppable.setNodeRef}
          className={cn(
            "mt-1 flex min-h-2 flex-col gap-0.5 rounded-md",
            droppable.isOver && category.channels.length === 0 && "bg-kumo-tint/40 py-2",
          )}
        >
          {category.channels.map((channel) => (
            <SortableChannel
              key={channel._id}
              channel={channel}
              serverId={serverId}
              canManage={canManage}
              active={pathname === `/app/servers/${serverId}/channels/${channel._id}`}
              participants={participants.filter((p) => p.channelId === channel._id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableChannel({
  channel,
  serverId,
  canManage,
  active,
  participants,
}: {
  channel: Channel;
  serverId: Id<"servers">;
  canManage: boolean;
  active: boolean;
  participants: Participant[];
}) {
  const sortable = useSortable({ id: chId(channel._id), disabled: !canManage, data: { kind: "ch" } });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      {...sortable.attributes}
      {...sortable.listeners}
      className={cn(sortable.isDragging && "opacity-40")}
    >
      <ChannelLink serverId={serverId} channel={channel} active={active} participants={participants} />
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
  channel: Channel;
  active: boolean;
  participants: Participant[];
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
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] font-medium text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-strong",
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
              <span className="truncate text-[13px] text-kumo-subtle">
                {p.user?.displayName ?? "Unknown"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
