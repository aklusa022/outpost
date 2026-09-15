"use client";

import { ReactNode, useEffect } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ServerRail } from "@/components/server-rail";
import { VoiceCallProvider } from "@/hooks/use-voice-call";
import { ActiveCallBar } from "@/components/voice/active-call-bar";

export default function AppLayout({ children }: { children: ReactNode }) {
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const user = useQuery(api.users.getCurrentUser);
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    // Creates the Convex user profile if the Clerk webhook hasn't synced it
    // yet. Has to wait until Convex actually holds the Clerk token — on a
    // bare mount the mutation runs unauthenticated and throws.
    if (!isAuthenticated) return;
    void ensureUser().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Every other query in the app assumes the current user's Convex profile
  // already exists, so hold off rendering anything else until it does —
  // this avoids a race with the `ensureUser` mutation above on first load.
  if (!user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-kumo-base">
        <p className="text-sm text-kumo-subtle">Loading…</p>
      </div>
    );
  }

  return (
    <VoiceCallProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-kumo-base">
        <div className="flex min-h-0 flex-1">
          <ServerRail />
          <div className="flex min-w-0 flex-1">{children}</div>
        </div>
        <ActiveCallBar />
      </div>
    </VoiceCallProvider>
  );
}
