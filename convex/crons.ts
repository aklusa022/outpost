import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Backstop for voice rosters: drops participants whose client stopped
// heartbeating (see STALE_PARTICIPANT_MS in voiceChannels.ts). Normal
// leaves are removed instantly by the client; this only catches crashes.
crons.interval(
  "reap stale voice participants",
  { seconds: 30 },
  internal.voiceChannels.reapStaleVoiceParticipants,
  {},
);

export default crons;
