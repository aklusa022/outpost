"use client";

import { useVoiceCall } from "@/hooks/use-voice-call";
import { Button } from "@/components/ui/button";
import {
  MicrophoneIcon,
  MicrophoneSlashIcon,
  HeadphonesIcon,
  SpeakerSlashIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneDisconnectIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";

export function ActiveCallBar() {
  const { status, activeChannelId, isMuted, isDeafened, isCameraOn, toggleMute, toggleCamera, toggleDeafen, leave } =
    useVoiceCall();

  if (status === "idle" || !activeChannelId) return null;

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-t bg-kumo-elevated px-3">
      <SpeakerHighIcon className="h-4 w-4 shrink-0 text-emerald-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-emerald-500">
          {status === "connecting" ? "Connecting…" : "Voice Connected"}
        </p>
      </div>
      <Button size="icon-sm" variant="ghost" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
        {isMuted ? (
          <MicrophoneSlashIcon className="h-4 w-4" />
        ) : (
          <MicrophoneIcon className="h-4 w-4" />
        )}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={toggleDeafen}
        aria-label={isDeafened ? "Undeafen" : "Deafen"}
      >
        {isDeafened ? (
          <SpeakerSlashIcon className="h-4 w-4" />
        ) : (
          <HeadphonesIcon className="h-4 w-4" />
        )}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={toggleCamera}
        aria-label={isCameraOn ? "Turn camera off" : "Turn camera on"}
      >
        {isCameraOn ? (
          <VideoCameraIcon className="h-4 w-4" />
        ) : (
          <VideoCameraSlashIcon className="h-4 w-4" />
        )}
      </Button>
      <Button
        size="icon-sm"
        variant="destructive"
        onClick={() => void leave()}
        aria-label="Disconnect"
      >
        <PhoneDisconnectIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
