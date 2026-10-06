import { useEffect, useState } from "react";
import { snapshotSchema, type Snapshot } from "./types";

/**
 * Where the daily snapshot comes from. A GitHub Action publishes it to the `data` branch (never `main`, so the
 * Lovable-synced history stays clean). If that is unreachable or malformed we fall back to the copy bundled in
 * /public, which is refreshed whenever the models are retrained - so the card still works offline.
 */
export const REMOTE_URL =
  "https://raw.githubusercontent.com/PravinRaj01/paun/data/market-snapshot.json";
export const BUNDLED_URL = "/data/market-snapshot.json";
const REMOTE_TIMEOUT_MS = 6000;

export type SnapshotSource = "remote" | "bundled";
export type LoadedSnapshot = { snapshot: Snapshot; source: SnapshotSource };

export const parseSnapshot = (json: unknown): Snapshot => snapshotSchema.parse(json);

async function load(url: string, timeoutMs: number): Promise<Snapshot> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-cache" });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return parseSnapshot(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSnapshot(): Promise<LoadedSnapshot> {
  try {
    return { snapshot: await load(REMOTE_URL, REMOTE_TIMEOUT_MS), source: "remote" };
  } catch {
    return { snapshot: await load(BUNDLED_URL, REMOTE_TIMEOUT_MS), source: "bundled" };
  }
}

let inflight: Promise<LoadedSnapshot> | null = null;
/** One shared request per page load, however many components ask. A failure is not cached, so a later mount retries. */
export function getSnapshot(): Promise<LoadedSnapshot> {
  inflight ??= fetchSnapshot().catch((e) => {
    inflight = null;
    throw e;
  });
  return inflight;
}

export type SnapshotState =
  { status: "loading" } | { status: "error" } | ({ status: "ready" } & LoadedSnapshot);

/** Client-only: runs in an effect, so server rendering never touches the network. */
export function useSnapshot(): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    getSnapshot().then(
      (r) => alive && setState({ status: "ready", ...r }),
      () => alive && setState({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
