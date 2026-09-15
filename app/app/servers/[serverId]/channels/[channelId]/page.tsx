"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useServerPermissions } from "@/hooks/use-server-permissions";
import { useAttachmentUploads } from "@/hooks/use-attachment-uploads";
import { PERMISSIONS } from "@/convex/permissionFlags";
import { ChatPanel } from "@/components/chat/chat-panel";
import { VoiceChannelView } from "@/components/voice/voice-channel-view";
import { ChannelHeader } from "@/components/server/channel-header";
import { ChannelSidePanel } from "@/components/server/channel-side-panel";

export default function ChannelPage({
  params,
}: {
  params: Promise<{ serverId: string; channelId: string }>;
}) {
  const { serverId, channelId } = use(params);
  const sId = serverId as Id<"servers">;
  const cId = channelId as Id<"channels">;
  const { user } = useCurrentUser();
  const permissions = useServerPermissions(sId);
  const channels = useQuery(api.channels.listChannels, { serverId: sId });
  const channel = channels?.find((c) => c._id === cId);
  const router = useRouter();

  // If this channel gets deleted (e.g. by an admin) while we're viewing it,
  // bounce back to the server's default channel instead of crashing on a
  // "channel not found" query error.
  const channelMissing = channels !== undefined && !channel;
  useEffect(() => {
    if (channelMissing) {
      router.replace(`/app/servers/${sId}`);
    }
  }, [channelMissing, router, sId]);

  const isVoice = channel?.type === "voice";
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listMessages,
    channelMissing || isVoice ? "skip" : { channelId: cId },
    { initialNumItems: 30 },
  );
  const sendMessage = useMutation(api.messages.sendMessage);
  const editMessage = useMutation(api.messages.editMessage);
  const deleteMessage = useMutation(api.messages.deleteMessage);
  const uploader = useAttachmentUploads(cId);
  const [rightPanel, setRightPanel] = useState<"members" | "search" | null>("members");

  if (!user || channelMissing) return null;

  // Voice channels have no messages to search, so only the member list applies.
  const panel = isVoice && rightPanel === "search" ? null : rightPanel;
  const header = (
    <ChannelHeader
      channelName={channel?.name ?? "channel"}
      channelType={isVoice ? "voice" : "text"}
      rightPanel={panel}
      onToggle={(mode) => setRightPanel((prev) => (prev === mode ? null : mode))}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {isVoice ? (
          <>
            {header}
            <div className="min-h-0 flex-1">
              <VoiceChannelView serverId={sId} channelId={cId} channelName={channel.name} />
            </div>
          </>
        ) : (
          <ChatPanel
            header={header}
            messages={results}
            hasMore={status === "CanLoadMore"}
            isLoadingMore={status === "LoadingMore"}
            onLoadMore={() => loadMore(30)}
            currentUserId={user._id}
            canManageMessages={permissions.can(PERMISSIONS.MANAGE_MESSAGES)}
            uploader={permissions.can(PERMISSIONS.ATTACH_FILES) ? uploader : undefined}
            onSend={(content, attachmentIds) =>
              sendMessage({
                channelId: cId,
                content,
                attachmentIds: attachmentIds as Id<"attachments">[],
              })
            }
            onEdit={(messageId, content) =>
              editMessage({ messageId: messageId as Id<"messages">, content })
            }
            onDelete={(messageId) =>
              deleteMessage({ messageId: messageId as Id<"messages"> })
            }
            placeholder={channel ? `Message #${channel.name}` : "Message…"}
          />
        )}
      </div>
      {panel && (
        <ChannelSidePanel
          mode={panel}
          serverId={sId}
          channelId={cId}
          className="w-60 shrink-0"
        />
      )}
    </div>
  );
}
