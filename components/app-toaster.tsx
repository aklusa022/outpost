"use client";

import type { ReactNode } from "react";
import { Toasty } from "@cloudflare/kumo";
import { toastManager } from "@/lib/toast";

/**
 * Kumo's toast provider + viewport, bound to the module-level manager in
 * `lib/toast.ts` so toasts can be fired from anywhere (event handlers,
 * async callbacks) without a hook. Client component because the manager
 * instance can't cross the server → client boundary as a prop.
 */
export function AppToaster({ children }: { children: ReactNode }) {
  return <Toasty toastManager={toastManager}>{children}</Toasty>;
}
