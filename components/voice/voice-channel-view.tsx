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

function RosterTiles({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="flex max-w-2xl flex-wrap justify-center gap-3">
      {roster.map((p) => (
        <div
          key={p.userId}
          className="flex w-32 flex-col items-center gap-2 rounded-xl bg-kumo-elevated px-4 py-4 ring ring-kumo-line"
        >
          <UserAvatar
            name={p.user?.displayName ?? "?"}
            imageUrl={p.user?.imageUrl}
            className="h-12 w-12"
          />
          <span className="w-full truncate text-center text-sm font-medium">
            {p.user?.displayName ?? "Unknown"}
          </span>
        </div>
      ))}
    </div>
  );
}

function CallLobby({
  channelName,
  roster,
  subtitle,
  action,
}: {
  channelName: string;
  roster: RosterEntry[];
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 overflow-y-auto p-8">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-kumo-tint">
          <SpeakerHighIcon className="h-10 w-10 text-kumo-default" weight="fill" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-xl font-semibold">{channelName}</h2>
          <p className="text-sm text-kumo-subtle">{subtitle}</p>
        </div>
      </div>
      {roster.length > 0 && <RosterTiles roster={roster} />}
      {action}
    </div>
  );
}

function describeRoster(count: number) {
  if (count === 0) return "No one is here yet — be the first to join.";
  if (count === 1) return "1 person is in the call.";
  return `${count} people are in the call.`;
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
    return <CallLobby channelName={channelName} roster={joiningRoster} subtitle="Joining…" />;
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
    <CallLobby
      channelName={channelName}
      roster={roster}
      subtitle={describeRoster(roster.length)}
      action={
        <Button size="lg" onClick={handleJoin} disabled={status === "connecting"}>
          {inAnotherCall ? "Switch to This Call" : "Join Call"}
        </Button>
      }
    />
  );
}
