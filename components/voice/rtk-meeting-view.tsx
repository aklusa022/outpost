"use client";

import { RtkMeeting } from "@cloudflare/realtimekit-react-ui";
import type Meeting from "@cloudflare/realtimekit";

/**
 * The only file that imports `@cloudflare/realtimekit-react-ui`. Everything
 * else talks to the call through `useVoiceCall()`.
 *
 * This deliberately renders RealtimeKit's stock, all-in-one `RtkMeeting`
 * component (grid, controlbar, chat/polls/participants sidebar, dialogs,
 * notifications, and participant audio) with no per-component composition
 * and no design-token overrides. Composing/theming individual UI Kit
 * components is intentionally deferred — an earlier hand-composed version
 * omitted `RtkSidebar`, so the controlbar's Chat/Polls/Participants buttons
 * toggled state that nothing rendered.
 *
 * `showSetupScreen` is off because the call is already joined by the time
 * this mounts (`useVoiceCall().join()` awaits `meeting.join()` before
 * reporting `connected`). `leaveOnUnmount` stays at its default (false):
 * navigating away from the channel page must not end the call — the
 * persistent `ActiveCallBar` keeps it alive across routes, and the hook's
 * `leave()` is the only place a call ends.
 */
export function RtkMeetingView({ meeting }: { meeting: Meeting }) {
  return (
    <div className="h-full w-full">
      <RtkMeeting meeting={meeting} mode="fill" showSetupScreen={false} />
    </div>
  );
}
