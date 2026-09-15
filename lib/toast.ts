import { createKumoToastManager } from "@cloudflare/kumo";

/**
 * App-wide Kumo toast manager. `<AppToaster>` (mounted in the root layout)
 * renders the viewport for it; `toast.*` below can be called from any code
 * path — event handlers, async catch blocks — without needing a hook.
 */
export const toastManager = createKumoToastManager();

type ToastInput = { title: string; description?: string };

function normalize(input: string | ToastInput): ToastInput {
  return typeof input === "string" ? { title: input } : input;
}

export const toast = {
  error(input: string | ToastInput) {
    return toastManager.add({ ...normalize(input), variant: "error" });
  },
  success(input: string | ToastInput) {
    return toastManager.add({ ...normalize(input), variant: "success" });
  },
  info(input: string | ToastInput) {
    return toastManager.add({ ...normalize(input), variant: "default" });
  },
};
