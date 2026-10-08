import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { readToken, signOut as signOutAccount, useAccount } from "@/lib/account";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";
import { registerSyncTrigger, setSyncStatus } from "@/lib/sync-status";
import { loadSyncState, newTombstones, runSync, saveSyncState, stampMissing, type SyncState } from "@/lib/vault-sync";

/**
 * Keeps the Vault in step with the account (PLAN.md 4b.4). It renders nothing. While the person is signed in it syncs: right after
 * sign-in, on page load, a couple of seconds after the Vault changes, when the connection returns, when the tab comes back into
 * view, and when "Sync now" is pressed. The five places that write the Vault are untouched: this component only watches it.
 *
 * Even while signed out it notices pieces the person REMOVES (on a device that has synced before) and remembers them, so that signing
 * in again tells the account about the removal instead of letting the piece come back.
 */
const DEBOUNCE_MS = 2500;

export function VaultSyncRunner() {
  const { vault, setVault, hydrated } = useGold();
  const account = useAccount();
  const { t } = useI18n();
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const stateRef = useRef<SyncState | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const serverRemoved = useRef<Set<string>>(new Set());
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = account.status === "signedIn" ? account.user.id : null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const tRef = useRef(t);
  tRef.current = t;

  const save = (s: SyncState) => {
    stateRef.current = s;
    saveSyncState(s);
  };

  const sync = useCallback(async () => {
    const uid = userIdRef.current;
    const token = readToken();
    if (!uid || !token || !stateRef.current) return;
    if (running.current) {
      again.current = true; // something changed while syncing: go round once more afterwards
      return;
    }
    running.current = true;
    setSyncStatus({ phase: "syncing", error: null });
    try {
      const stamped = stampMissing(vaultRef.current, new Date());
      if (stamped !== vaultRef.current) {
        vaultRef.current = stamped;
        setVault(stamped);
      }
      const firstSync = stateRef.current.userId !== uid;
      const r = await runSync({ token, userId: uid, vault: stamped, state: stateRef.current });
      if (!r.ok) {
        setSyncStatus({ phase: "failed", error: r.error });
        // the server no longer accepts this session (it expired, or the account was deleted elsewhere): sign out here, quietly
        if (r.error === "signed_out") void signOutAccount();
        return;
      }
      const merged = r.merge(vaultRef.current);
      if (merged.added || merged.updated || merged.removed.length) {
        serverRemoved.current = new Set(merged.removed);
        vaultRef.current = merged.vault;
        setVault(merged.vault);
      }
      save(r.state);
      setSyncStatus({ phase: "idle", error: null, lastSyncAt: r.state.lastSyncAt, skipped: r.skipped });
      if (merged.added > 0 && firstSync) toast.success(tRef.current("syncMerged", { n: merged.added }));
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        schedule();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setVault]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sync(), DEBOUNCE_MS);
  }, [sync]);

  // "Sync now" in the Account block
  useEffect(() => {
    registerSyncTrigger(() => void sync());
    return () => registerSyncTrigger(null);
  }, [sync]);

  // load what the device remembers, once the Vault itself has loaded
  useEffect(() => {
    if (!hydrated || stateRef.current) return;
    stateRef.current = loadSyncState();
    knownIds.current = new Set(vaultRef.current.map((v) => v.id));
    if (stateRef.current.lastSyncAt) setSyncStatus({ lastSyncAt: stateRef.current.lastSyncAt });
  }, [hydrated]);

  // the Vault changed: remember removals, then (if signed in) sync soon
  useEffect(() => {
    if (!hydrated || !stateRef.current || !knownIds.current) return;
    const state = stateRef.current;
    if (state.userId !== null) {
      const gone = newTombstones(knownIds.current, vault, serverRemoved.current, new Date());
      if (gone.length) save({ ...state, tombstones: [...state.tombstones, ...gone].slice(-2000) });
    }
    knownIds.current = new Set(vault.map((v) => v.id));
    serverRemoved.current = new Set();
    if (userIdRef.current) schedule();
  }, [vault, hydrated, schedule]);

  // signed in (or back from being unreachable): sync now
  useEffect(() => {
    if (userId && hydrated) void sync();
  }, [userId, hydrated, sync]);

  // the connection came back, or the tab came back into view
  useEffect(() => {
    const wake = () => {
      if (userIdRef.current && document.visibilityState !== "hidden") schedule();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  return null;
}
