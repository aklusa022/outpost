"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import type Meeting from "@cloudflare/realtimekit";
import type { RTKClientOptions } from "@cloudflare/realtimekit";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type CallStatus = "idle" | "connecting" | "connected";

type VoiceCallContextValue = {
  meeting: Meeting | undefined;
  status: CallStatus;
  activeChannelId: Id<"channels"> | null;
  activeServerId: Id<"servers"> | null;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  join: (channelId: Id<"channels">, serverId: Id<"servers">) => Promise<void>;
  leave: () => Promise<void>;
  /**
   * Pre-warms a call so a later `join()` is near-instant: makes sure a
   * participant token is cached and initializes the RealtimeKit client
   * (auth, socket, media transports, mic if already permitted) without
   * joining. No-op unless idle. Call from the channel's "Join Call" screen.
   */
  prepare: (channelId: Id<"channels">) => void;
  /** Tears down a `prepare()`d-but-never-joined client for that channel. */
  discardPrepared: (channelId: Id<"channels">) => void;
  /** Ensures a participant token is cached for the channel (no SDK work). */
  warmToken: (channelId: Id<"channels">) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleDeafen: () => void;
};

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

const HEARTBEAT_INTERVAL_MS = 20_000;

type TokenInfo = { authToken: string; rtkMeetingId: string };

// RealtimeKit's error code for "auth token rejected" (401/403/404 from the
// participant-details call inside `init`). Treated as a stale cached token.
const RTK_TOKEN_REJECTED_CODE = "0004";

async function micAlreadyGranted(): Promise<boolean> {
  try {
    const result = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return result.state === "granted";
  } catch {
    return false;
  }
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [status, setStatus] = useState<CallStatus>("idle");
  const [activeChannelId, setActiveChannelId] = useState<Id<"channels"> | null>(null);
  const [activeServerId, setActiveServerId] = useState<Id<"servers"> | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);

  const convex = useConvex();
  const ensureVoiceToken = useAction(api.voiceChannels.ensureVoiceToken);
  const markJoined = useMutation(api.voiceChannels.markJoined);
  const leaveVoiceChannel = useMutation(api.voiceChannels.leaveVoiceChannel);
  const heartbeat = useMutation(api.voiceChannels.heartbeat);

  // Every cached token this user may use, kept live by Convex. Fixed `now`
  // per mount keeps the subscription stable; token freshness has a 70-day
  // margin so a long-lived tab can't drift into an expired token.
  const now = useMemo(() => Date.now(), []);
  const myTokens = useQuery(api.voiceChannels.myVoiceTokens, { now });
  const tokensRef = useRef(new Map<Id<"channels">, TokenInfo>());
  useEffect(() => {
    const map = new Map<Id<"channels">, TokenInfo>();
    for (const t of myTokens ?? []) {
      map.set(t.channelId, { authToken: t.authToken, rtkMeetingId: t.rtkMeetingId });
    }
    tokensRef.current = map;
  }, [myTokens]);

  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;
  const statusRef = useRef(status);
  statusRef.current = status;
  const beaconTokenRef = useRef<string | null>(null);

  // A client that was `prepare()`d for a channel and not joined yet.
  const preparedRef = useRef<{
    channelId: Id<"channels">;
    meeting: Meeting;
    audioEnabled: boolean;
  } | null>(null);
  const preparingRef = useRef<{
    channelId: Id<"channels">;
    promise: Promise<{ meeting: Meeting; audioEnabled: boolean } | null>;
  } | null>(null);
  const tokenRequestsRef = useRef(new Map<Id<"channels">, Promise<TokenInfo>>());

  const reset = useCallback(() => {
    setStatus("idle");
    setActiveChannelId(null);
    setActiveServerId(null);
    setIsMuted(false);
    setIsDeafened(false);
    setIsCameraOn(false);
    beaconTokenRef.current = null;
  }, []);

  const getToken = useCallback(
    async (channelId: Id<"channels">, force = false): Promise<TokenInfo> => {
      const cached = tokensRef.current.get(channelId);
      if (cached && !force) return cached;
      let inflight = tokenRequestsRef.current.get(channelId);
      if (!inflight || force) {
        inflight = ensureVoiceToken({ channelId, force }).then((t) => {
          tokensRef.current.set(channelId, t);
          return t;
        });
        tokenRequestsRef.current.set(channelId, inflight);
        inflight.finally(() => {
          if (tokenRequestsRef.current.get(channelId) === inflight) {
            tokenRequestsRef.current.delete(channelId);
          }
        });
      }
      return inflight;
    },
    [ensureVoiceToken],
  );

  const warmToken = useCallback(
    (channelId: Id<"channels">) => {
      if (tokensRef.current.has(channelId)) return;
      void getToken(channelId).catch(() => {});
    },
    [getToken],
  );

  // Initializes the SDK client; if RealtimeKit rejects the (cached) token,
  // re-issues one and retries once.
  const initWithRetry = useCallback(
    async (
      channelId: Id<"channels">,
      makeOptions: (authToken: string) => RTKClientOptions,
    ): Promise<Meeting> => {
      const attempt = async (force: boolean) => {
        const { authToken } = await getToken(channelId, force);
        const client = await initMeeting(makeOptions(authToken));
        if (!client) throw new Error("Failed to initialize the call");
        return client;
      };
      try {
        return await attempt(false);
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== RTK_TOKEN_REJECTED_CODE) throw err;
        return attempt(true);
      }
    },
    [getToken, initMeeting],
  );

  const discardPrepared = useCallback((channelId?: Id<"channels">) => {
    const prepared = preparedRef.current;
    if (!prepared) return;
    if (channelId && prepared.channelId !== channelId) return;
    preparedRef.current = null;
    // Safe on a never-joined client: stops transports and closes the socket.
    prepared.meeting.leave().catch(() => {});
  }, []);

  const prepare = useCallback(
    (channelId: Id<"channels">) => {
      if (statusRef.current !== "idle") return;
      if (preparedRef.current?.channelId === channelId) return;
      if (preparingRef.current?.channelId === channelId) return;
      discardPrepared();

      const promise = (async () => {
        const audioEnabled = await micAlreadyGranted();
        const client = await initWithRetry(channelId, (authToken) => ({
          authToken,
          defaults: { audio: audioEnabled, video: false },
        }));
        return { meeting: client, audioEnabled };
      })()
        .then((result) => {
          // Only keep it if nothing changed while we were initializing.
          if (preparingRef.current?.promise === promise && statusRef.current === "idle") {
            preparedRef.current = { channelId, ...result };
            return result;
          }
          result.meeting.leave().catch(() => {});
          return null;
        })
        .catch((err) => {
          console.warn("Voice pre-warm failed; will retry on join", err);
          return null;
        })
        .finally(() => {
          if (preparingRef.current?.promise === promise) preparingRef.current = null;
        });
      preparingRef.current = { channelId, promise };
    },
    [discardPrepared, initWithRetry],
  );

  const leave = useCallback(async () => {
    const current = meetingRef.current;
    beaconTokenRef.current = null;
    await Promise.all([
      current?.leave().catch(() => {}),
      leaveVoiceChannel({}).catch(() => {}),
    ]);
    reset();
  }, [leaveVoiceChannel, reset]);

  const join = useCallback(
    async (channelId: Id<"channels">, serverId: Id<"servers">) => {
      if (statusRef.current !== "idle") await leave();

      setStatus("connecting");
      statusRef.current = "connecting";
      setActiveChannelId(channelId);
      setActiveServerId(serverId);

      const beaconToken = crypto.randomUUID();
      beaconTokenRef.current = beaconToken;
      // Record the join right away so other users' rosters update at click
      // time rather than after WebRTC finishes. Also the authorization guard.
      const markJoinedPromise = markJoined({ channelId, beaconToken });
      markJoinedPromise.catch(() => {});

      let client: Meeting | undefined;
      try {
        // Reuse a pre-warmed client if we have (or are getting) one.
        if (preparingRef.current?.channelId === channelId) {
          await preparingRef.current.promise;
        }
        let audioEnabled = false;
        if (preparedRef.current?.channelId === channelId) {
          client = preparedRef.current.meeting;
          audioEnabled = preparedRef.current.audioEnabled;
          preparedRef.current = null;
        } else {
          discardPrepared();
          audioEnabled = await micAlreadyGranted();
          client = await initWithRetry(channelId, (authToken) => ({
            authToken,
            defaults: { audio: audioEnabled, video: false },
          }));
        }

        await Promise.all([
          client.join(),
          // Mic comes up concurrently with the media join; a missing or
          // denied mic joins muted instead of failing the call.
          audioEnabled ? Promise.resolve() : client.self.enableAudio().catch(() => {}),
          markJoinedPromise,
        ]);
        setStatus("connected");
        statusRef.current = "connected";
      } catch (err) {
        client?.leave().catch(() => {});
        leaveVoiceChannel({}).catch(() => {});
        reset();
        throw err;
      }
    },
    [leave, markJoined, discardPrepared, initWithRetry, leaveVoiceChannel, reset],
  );

  // Clears local state if the call ends from outside `leave()` — the stock
  // RealtimeKit controlbar's Leave button, a kick, or the host ending the
  // meeting — and removes our roster row immediately instead of waiting for
  // the RealtimeKit webhook. Ignored for pre-warmed clients being discarded.
  useEffect(() => {
    if (!meeting) return;
    const onRoomLeft = () => {
      if (statusRef.current === "idle") return;
      beaconTokenRef.current = null;
      void leaveVoiceChannel({}).catch(() => {});
      reset();
    };
    meeting.self.on("roomLeft", onRoomLeft);
    return () => {
      meeting.self.off("roomLeft", onRoomLeft);
    };
  }, [meeting, leaveVoiceChannel, reset]);

  // Derive mute/camera state from the SDK itself rather than only from our
  // own toggle handlers — the in-call view's mic/camera buttons live inside
  // RealtimeKit's own controlbar, which calls the SDK directly.
  useEffect(() => {
    if (!meeting) return;
    const onAudioUpdate = ({ audioEnabled }: { audioEnabled: boolean }) =>
      setIsMuted(!audioEnabled);
    const onVideoUpdate = ({ videoEnabled }: { videoEnabled: boolean }) =>
      setIsCameraOn(videoEnabled);
    meeting.self.on("audioUpdate", onAudioUpdate);
    meeting.self.on("videoUpdate", onVideoUpdate);
    return () => {
      meeting.self.off("audioUpdate", onAudioUpdate);
      meeting.self.off("videoUpdate", onVideoUpdate);
    };
  }, [meeting]);

  useEffect(() => {
    if (status !== "connected") return;
    const interval = setInterval(() => void heartbeat({}), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, heartbeat]);

  // Tab close / navigation away from the app: an authenticated mutation
  // can't complete during unload, so fire a beacon carrying this tab's
  // secret to drop our roster row (same approach as @convex-dev/presence).
  useEffect(() => {
    if (status !== "connected") return;
    const onUnload = () => {
      const beaconToken = beaconTokenRef.current;
      if (!beaconToken) return;
      const blob = new Blob(
        [JSON.stringify({ path: "voiceChannels:leaveByBeacon", args: { beaconToken } })],
        { type: "application/json" },
      );
      navigator.sendBeacon(`${convex.url}/api/mutation`, blob);
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [status, convex]);

  const toggleMute = useCallback(() => {
    if (!meeting) return;
    if (isMuted) meeting.self.enableAudio();
    else meeting.self.disableAudio();
    setIsMuted((v) => !v);
  }, [meeting, isMuted]);

  const toggleCamera = useCallback(() => {
    if (!meeting) return;
    if (isCameraOn) meeting.self.disableVideo();
    else meeting.self.enableVideo();
    setIsCameraOn((v) => !v);
  }, [meeting, isCameraOn]);

  // RealtimeKit has no first-class "deafen" primitive — this is a v1
  // simplification tracked only locally; the UI Kit view is expected to
  // mute rendered remote audio when this is on.
  const toggleDeafen = useCallback(() => setIsDeafened((v) => !v), []);

  return (
    <VoiceCallContext.Provider
      value={{
        meeting,
        status,
        activeChannelId,
        activeServerId,
        isMuted,
        isDeafened,
        isCameraOn,
        join,
        leave,
        prepare,
        discardPrepared,
        warmToken,
        toggleMute,
        toggleCamera,
        toggleDeafen,
      }}
    >
      {children}
    </VoiceCallContext.Provider>
  );
}

export function useVoiceCall(): VoiceCallContextValue {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) throw new Error("useVoiceCall must be used within a VoiceCallProvider");
  return ctx;
}
