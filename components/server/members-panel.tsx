"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { UserAvatar } from "@/components/user-avatar";
import { useServerPresence } from "@/hooks/use-server-presence";
import { cn } from "@/lib/utils";

type Member = {
  user: Doc<"users"> | null;
  roles: Doc<"roles">[];
};

const STATUS_DOT: Record<"online" | "idle" | "dnd" | "offline", string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-500",
  dnd: "bg-red-500",
  offline: "bg-kumo-subtle/40",
};

function effectiveStatus(
  user: Doc<"users">,
  online: boolean,
): "online" | "idle" | "dnd" | "offline" {
  if (user.status === "invisible") return "offline";
  if (!online) return "offline";
  if (user.status === "idle" || user.status === "dnd") return user.status;
  return "online";
}

export function MembersPanel({ serverId }: { serverId: Id<"servers"> }) {
  const members = useQuery(api.servers.listMembers, { serverId });
  const presence = useServerPresence();

  if (!members) {
    return <p className="p-4 text-sm text-kumo-subtle">Loading members…</p>;
  }

  const onlineByUserId = new Map(presence?.map((p) => [p.userId, p.online]) ?? []);

  const withStatus = (members as Member[])
    .filter((m): m is Member & { user: Doc<"users"> } => m.user !== null)
    .map((m) => ({
      member: m,
      status: effectiveStatus(m.user, onlineByUserId.get(m.user._id) ?? false),
    }));

  const online = withStatus
    .filter((m) => m.status !== "offline")
    .sort((a, b) => a.member.user.displayName.localeCompare(b.member.user.displayName));
  const offline = withStatus
    .filter((m) => m.status === "offline")
    .sort((a, b) => a.member.user.displayName.localeCompare(b.member.user.displayName));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <MemberSection title={`Online — ${online.length}`} entries={online} />
      <MemberSection title={`Offline — ${offline.length}`} entries={offline} />
    </div>
  );
}

function MemberSection({
  title,
  entries,
}: {
  title: string;
  entries: { member: Member & { user: Doc<"users"> }; status: "online" | "idle" | "dnd" | "offline" }[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 text-xs font-semibold uppercase text-kumo-subtle">
        {title}
      </span>
      {entries.map(({ member, status }) => (
        <div
          key={member.user._id}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5",
            status === "offline" ? "opacity-50" : "hover:bg-kumo-tint",
          )}
        >
          <div className="relative shrink-0">
            <UserAvatar name={member.user.displayName} imageUrl={member.user.imageUrl} className="h-8 w-8" />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-kumo-line",
                STATUS_DOT[status],
              )}
            />
          </div>
          <span className="truncate text-[15px] font-medium">{member.user.displayName}</span>
        </div>
      ))}
    </div>
  );
}
