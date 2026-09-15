"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Input } from "@cloudflare/kumo";
import { UserAvatar } from "@/components/user-avatar";

export function SearchPanel({ channelId }: { channelId: Id<"channels"> }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const results = useQuery(
    api.messages.searchMessages,
    debounced ? { channelId, query: debounced } : "skip",
  );

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages"
        className="w-full min-w-0"
      />
      <div className="flex-1 overflow-y-auto">
        {!debounced && (
          <p className="p-2 text-sm text-kumo-subtle">
            Search this channel&apos;s message history.
          </p>
        )}
        {debounced && results?.length === 0 && (
          <p className="p-2 text-sm text-kumo-subtle">No matching messages.</p>
        )}
        <div className="flex flex-col gap-1">
          {results?.map((message) => (
            <div key={message._id} className="flex items-start gap-2 rounded-md p-2 hover:bg-kumo-tint">
              <UserAvatar
                name={message.author?.displayName ?? "Unknown"}
                imageUrl={message.author?.imageUrl}
                className="h-7 w-7 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-sm font-semibold">
                    {message.author?.displayName ?? "Unknown user"}
                  </span>
                  <span className="shrink-0 text-[11px] text-kumo-subtle">
                    {new Date(message._creationTime).toLocaleString()}
                  </span>
                </div>
                <p className="truncate text-sm text-kumo-subtle">{message.content}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
