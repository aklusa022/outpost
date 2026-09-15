"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

export default function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const info = useQuery(api.invites.getInviteInfo, { code });
  const joinByInvite = useMutation(api.invites.joinByInvite);
  const router = useRouter();
  const [joining, setJoining] = useState(false);

  async function handleJoin() {
    setJoining(true);
    try {
      const serverId = await joinByInvite({ code });
      router.push(`/app/servers/${serverId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join server");
      setJoining(false);
    }
  }

  if (info === undefined) {
    return <Centered>Loading invite…</Centered>;
  }

  if (info === null) {
    return <Centered>This invite is invalid or has expired.</Centered>;
  }

  return (
    <Centered>
      <div className="space-y-1">
        <p className="text-sm text-kumo-subtle">You&apos;ve been invited to join</p>
        <h1 className="text-2xl font-bold">{info.server.name}</h1>
        <p className="text-sm text-kumo-subtle">
          {info.memberCount} member{info.memberCount === 1 ? "" : "s"}
        </p>
      </div>
      <AuthLoading>
        <p className="text-sm text-kumo-subtle">Loading…</p>
      </AuthLoading>
      <Authenticated>
        <Button size="lg" disabled={joining} onClick={handleJoin}>
          Accept invite
        </Button>
      </Authenticated>
      <Unauthenticated>
        <div className="flex gap-3">
          <SignInButton mode="modal">
            <Button size="lg">Sign in to join</Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button size="lg" variant="outline">
              Create an account
            </Button>
          </SignUpButton>
        </div>
      </Unauthenticated>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-kumo-base px-6 text-center">
      {children}
    </main>
  );
}
