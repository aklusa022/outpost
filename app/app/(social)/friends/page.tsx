"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "@/components/user-avatar";
import { AddFriendDialog } from "@/components/add-friend-dialog";
import { useRouter } from "next/navigation";
import { CheckIcon, ChatIcon, XIcon } from "@phosphor-icons/react";

export default function FriendsPage() {
  const friends = useQuery(api.friends.listFriends);
  const incoming = useQuery(api.friends.listIncomingRequests);
  const outgoing = useQuery(api.friends.listOutgoingRequests);
  const respond = useMutation(api.friends.respondToFriendRequest);
  const cancel = useMutation(api.friends.cancelFriendRequest);
  const removeFriend = useMutation(api.friends.removeFriend);
  const getOrCreateConversation = useMutation(api.dms.getOrCreateConversation);
  const router = useRouter();

  async function openDm(userId: Id<"users">) {
    try {
      const conversationId = await getOrCreateConversation({
        otherUserId: userId,
      });
      router.push(`/app/dm/${conversationId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open DM");
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h1 className="font-semibold">Friends</h1>
        <AddFriendDialog />
      </div>
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-8 p-6">
          {incoming && incoming.length > 0 && (
            <Section title={`Incoming requests — ${incoming.length}`}>
              {incoming.map((r) =>
                r.fromUser ? (
                  <Row key={r._id} name={r.fromUser.displayName} imageUrl={r.fromUser.imageUrl}>
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={() => respond({ requestId: r._id, accept: true })}
                      aria-label={`Accept friend request from ${r.fromUser.displayName}`}
                    >
                      <CheckIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={() => respond({ requestId: r._id, accept: false })}
                      aria-label={`Decline friend request from ${r.fromUser.displayName}`}
                    >
                      <XIcon className="h-4 w-4" />
                    </Button>
                  </Row>
                ) : null,
              )}
            </Section>
          )}

          {outgoing && outgoing.length > 0 && (
            <Section title={`Outgoing requests — ${outgoing.length}`}>
              {outgoing.map((r) =>
                r.toUser ? (
                  <Row key={r._id} name={r.toUser.displayName} imageUrl={r.toUser.imageUrl}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancel({ requestId: r._id })}
                    >
                      Cancel
                    </Button>
                  </Row>
                ) : null,
              )}
            </Section>
          )}

          <Section title={`All friends — ${friends?.length ?? 0}`}>
            {friends?.length === 0 && (
              <p className="text-sm text-kumo-subtle">
                No friends yet — add one by username above.
              </p>
            )}
            {friends?.map((f) => (
              <Row key={f._id} name={f.displayName} imageUrl={f.imageUrl}>
                <Button size="icon" variant="ghost" onClick={() => openDm(f._id)} aria-label={`Message ${f.displayName}`}>
                  <ChatIcon className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeFriend({ friendUserId: f._id })}
                >
                  Remove
                </Button>
              </Row>
            ))}
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase text-kumo-subtle">
        {title}
      </h2>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  name,
  imageUrl,
  children,
}: {
  name: string;
  imageUrl?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex items-center gap-3">
        <UserAvatar name={name} imageUrl={imageUrl} />
        <span className="font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
