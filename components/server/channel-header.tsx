"use client";

import { Button } from "@/components/ui/button";
import { HashIcon, MagnifyingGlassIcon, SpeakerHighIcon, UsersIcon } from "@phosphor-icons/react";

export function ChannelHeader({
  channelName,
  channelType = "text",
  rightPanel,
  onToggle,
}: {
  channelName: string;
  channelType?: "text" | "voice";
  rightPanel: "members" | "search" | null;
  onToggle: (mode: "members" | "search") => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-4 text-[15px] font-semibold">
      {channelType === "voice" ? (
        <SpeakerHighIcon className="h-4 w-4 shrink-0 text-kumo-subtle" />
      ) : (
        <HashIcon className="h-4 w-4 shrink-0 text-kumo-subtle" />
      )}
      <span className="min-w-0 flex-1 truncate">{channelName}</span>
      <div className="flex shrink-0 items-center gap-1">
        {channelType === "text" && (
          <Button
            size="icon"
            variant={rightPanel === "search" ? "secondary" : "ghost"}
            className="h-7 w-7"
            aria-label="Search messages"
            onClick={() => onToggle("search")}
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant={rightPanel === "members" ? "secondary" : "ghost"}
          className="h-7 w-7"
          aria-label="Toggle member list"
          onClick={() => onToggle("members")}
        >
          <UsersIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
