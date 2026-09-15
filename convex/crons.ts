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

// Attachments whose upload was started but never finalized (tab closed
// mid-upload, failed validation call, etc.) are deleted from R2 and the
// table after an hour; see PENDING_TTL_MS in attachments.ts.
crons.interval(
  "reap abandoned attachment uploads",
  { minutes: 30 },
  internal.attachments.reapAbandoned,
  {},
);

export default crons;
