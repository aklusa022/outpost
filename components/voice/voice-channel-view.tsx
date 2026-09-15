"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { RtkMeetingView } from "@/components/voice/rtk-meeting-view";
import { SpeakerHighIcon } from "@phosphor-icons/react";

type RosterEntry = {
  userId: Id<"users">;
  user: { displayName: string; imageUrl: string } | null;
};

function RosterList({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="flex flex-col gap-1">
      {roster.map((p) => (
        <div key={p.userId} className="flex items-center gap-2 rounded-md bg-kumo-tint/40 px-2 py-1.5">
          <UserAvatar name={p.user?.displayName ?? "?"} imageUrl={p.user?.imageUrl} />
          <span className="truncate text-sm">{p.user?.displayName ?? "Unknown"}</span>
        </div>
      ))}
    </div>
  );
}

export function VoiceChannelView({
  serverId,
  channelId,
  channelName,
}: {
  serverId: Id<"servers">;
  channelId: Id<"channels">;
  channelName: string;
}) {
  const { meeting, status, activeChannelId, join, prepare, discardPrepared } = useVoiceCall();
  const { user: me } = useCurrentUser();
  const participants = useQuery(api.voiceChannels.listVoiceParticipants, { serverId });
  const roster = participants?.filter((p) => p.channelId === channelId) ?? [];

  // Pre-warm the call while the user is looking at the Join button, so the
  // click itself only has to do the media join. Torn down if they navigate
  // away without joining.
  useEffect(() => {
    if (status !== "idle") return;
    prepare(channelId);
    return () => discardPrepared(channelId);
  }, [status, channelId, prepare, discardPrepared]);

  if (activeChannelId === channelId && status === "connected" && meeting) {
    return <RtkMeetingView meeting={meeting} />;
  }

  if (activeChannelId === channelId && status === "connecting") {
    const alreadyListed = me ? roster.some((p) => p.userId === me._id) : true;
    const joiningRoster: RosterEntry[] =
      me && !alreadyListed
        ? [...roster, { userId: me._id, user: { displayName: me.displayName, imageUrl: me.imageUrl } }]
        : roster;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="flex flex-col items-center gap-2">
          <SpeakerHighIcon className="h-10 w-10 text-kumo-subtle" />
          <p className="text-lg font-semibold">{channelName}</p>
          <p className="text-xs text-kumo-subtle">Joining…</p>
        </div>
        {joiningRoster.length > 0 && (
          <div className="flex w-full max-w-64 flex-col items-stretch gap-2">
            <RosterList roster={joiningRoster} />
          </div>
        )}
      </div>
    );
  }

  const inAnotherCall = status !== "idle" && activeChannelId !== channelId;

  async function handleJoin() {
    try {
      await join(channelId, serverId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join the call");
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-col items-center gap-2">
        <SpeakerHighIcon className="h-10 w-10 text-kumo-subtle" />
        <p className="text-lg font-semibold">{channelName}</p>
      </div>

      {roster.length > 0 && (
        <div className="flex w-full max-w-64 flex-col items-stretch gap-2">
          <p className="text-center text-xs text-kumo-subtle">In this call</p>
          <RosterList roster={roster} />
        </div>
      )}

      <Button onClick={handleJoin} disabled={status === "connecting"}>
        {inAnotherCall ? "Switch to This Call" : "Join Call"}
      </Button>
    </div>
  );
}
