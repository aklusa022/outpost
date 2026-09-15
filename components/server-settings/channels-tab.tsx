"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useServerPermissions } from "@/hooks/use-server-permissions";
import { PERMISSIONS } from "@/convex/permissionFlags";
import { CreateCategoryDialog } from "@/components/create-category-dialog";
import { CreateChannelDialog } from "@/components/create-channel-dialog";
import { FolderOpenIcon, HashIcon, TrashIcon, SpeakerHighIcon } from "@phosphor-icons/react";

export function ChannelsTab({ serverId }: { serverId: Id<"servers"> }) {
  const categories = useQuery(api.categories.listCategories, { serverId });
  const channels = useQuery(api.channels.listChannels, { serverId });
  const deleteCategory = useMutation(api.categories.deleteCategory);
  const deleteChannel = useMutation(api.channels.deleteChannel);
  const permissions = useServerPermissions(serverId);
  const canManage = permissions.can(PERMISSIONS.MANAGE_CHANNELS);
  const [pending, setPending] = useState<string | null>(null);

  if (!categories || !channels) return null;

  const sortedCategories = [...categories].sort((a, b) => a.position - b.position);

  async function handleDeleteChannel(channelId: Id<"channels">, name: string) {
    if (!confirm(`Delete #${name}? All of its messages will be lost.`)) return;
    setPending(channelId);
    try {
      await deleteChannel({ channelId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete channel");
    } finally {
      setPending(null);
    }
  }

  async function handleDeleteCategory(categoryId: Id<"categories">, name: string) {
    if (
      !confirm(
        `Delete the "${name}" category? Every channel in it (and its messages) will be deleted too.`,
      )
    )
      return;
    setPending(categoryId);
    try {
      await deleteCategory({ categoryId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete category");
    } finally {
      setPending(null);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-1 pr-4">
        {canManage && (
          <div className="flex items-center gap-2">
            <CreateCategoryDialog serverId={serverId} />
            <CreateChannelDialog serverId={serverId} categories={sortedCategories} />
          </div>
        )}
        <p className="text-xs text-kumo-subtle">
          Tip: drag channels and categories in the sidebar to reorder them.
        </p>

        {sortedCategories.map((category) => (
          <div key={category._id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-kumo-subtle">
                <FolderOpenIcon className="h-3.5 w-3.5" />
                {category.name}
              </p>
              {canManage && (
                <div className="flex items-center gap-1">
                  <CreateChannelDialog
                    serverId={serverId}
                    categories={sortedCategories}
                    defaultCategoryId={category._id}
                    compact
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-kumo-danger hover:text-kumo-danger"
                    disabled={pending === category._id || sortedCategories.length <= 1}
                    onClick={() => handleDeleteCategory(category._id, category.name)}
                    aria-label={`Delete ${category.name} category`}
                    title={
                      sortedCategories.length <= 1
                        ? "A server needs at least one category"
                        : `Delete ${category.name}`
                    }
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
            {channels
              .filter((c) => c.categoryId === category._id)
              .sort((a, b) => a.position - b.position)
              .map((channel) => (
                <ChannelRow
                  key={channel._id}
                  name={channel.name}
                  type={channel.type}
                  disabled={pending === channel._id}
                  canManage={canManage}
                  onDelete={() => handleDeleteChannel(channel._id, channel.name)}
                />
              ))}
          </div>
        ))}

        {sortedCategories.length === 0 && (
          <p className="text-sm text-kumo-subtle">
            No categories yet — create one above, then add channels to it.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

function ChannelRow({
  name,
  type,
  canManage,
  disabled,
  onDelete,
}: {
  name: string;
  type: "text" | "voice";
  canManage: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-kumo-tint/50">
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        {type === "voice" ? (
          <SpeakerHighIcon className="h-4 w-4 shrink-0 text-kumo-subtle" />
        ) : (
          <HashIcon className="h-4 w-4 shrink-0 text-kumo-subtle" />
        )}
        <span className="truncate">{name}</span>
      </span>
      {canManage && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-kumo-danger hover:text-kumo-danger"
          disabled={disabled}
          onClick={onDelete}
          aria-label={`Delete ${name} channel`}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
