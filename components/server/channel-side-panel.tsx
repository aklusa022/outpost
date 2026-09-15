"use client";

import { Id } from "@/convex/_generated/dataModel";
import { MembersPanel } from "@/components/server/members-panel";
import { SearchPanel } from "@/components/server/search-panel";
import { cn } from "@/lib/utils";

export function ChannelSidePanel({
  mode,
  serverId,
  channelId,
  className,
}: {
  mode: "members" | "search";
  serverId: Id<"servers">;
  channelId: Id<"channels">;
  className?: string;
}) {
  return (
    <div className={cn("border-l bg-kumo-elevated", className)}>
      {mode === "members" ? (
        <MembersPanel serverId={serverId} />
      ) : (
        <SearchPanel channelId={channelId} />
      )}
    </div>
  );
}
