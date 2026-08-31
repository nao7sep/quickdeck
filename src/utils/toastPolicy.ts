import type { ToastKind } from "../types";

export const INFO_TOAST_LIFETIME_MS = 4200;

export function toastLifetimeMs(kind: ToastKind): number | null {
  return kind === "info" ? INFO_TOAST_LIFETIME_MS : null;
}
