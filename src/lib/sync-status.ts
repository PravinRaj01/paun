import { useSyncExternalStore } from "react";
import type { SyncError } from "./vault-sync";

/**
 * What the sync is doing right now, for the status line in the Account block. One shared state for the whole app, like the account
 * itself; the background runner (`VaultSyncRunner`) writes it, the Account block reads it and can ask for a sync with `syncNow()`.
 */
export type SyncStatus = {
  phase: "idle" | "syncing" | "failed";
  error: SyncError | null; // set when phase is "failed"
  lastSyncAt: string | null; // an ISO moment (shown in the viewer's timezone)
  skipped: number; // pieces left out of the last sync because their details were invalid
};
const INITIAL: SyncStatus = { phase: "idle", error: null, lastSyncAt: null, skipped: 0 };

let status: SyncStatus = INITIAL;
const listeners = new Set<() => void>();
export function setSyncStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}
export const getSyncStatus = (): SyncStatus => status;
export const resetSyncStatus = (): void => {
  status = INITIAL;
  listeners.forEach((l) => l());
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => status,
    () => INITIAL,
  );
}

// "Sync now": the runner registers itself here, the Account block calls it.
let trigger: (() => void) | null = null;
export const registerSyncTrigger = (fn: (() => void) | null): void => {
  trigger = fn;
};
export const syncNow = (): void => trigger?.();
