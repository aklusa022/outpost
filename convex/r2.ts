import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";

// Reads R2_BUCKET / R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
// from the deployment's environment. Presigning is pure crypto, so
// `generateUploadUrl` and `getUrl` are usable from mutations and queries;
// anything that actually talks to the bucket (HEAD/GET) runs in an action
// via `r2.client`.
export const r2 = new R2(components.r2);
