import { useEffect, useSyncExternalStore } from "react";
import { API_BASE } from "./api";

/**
 * The optional account (PLAN.md 4b), browser side. Signing in is optional and nothing in the app depends on it.
 *
 * The session lives in a bearer token the Worker hands back after Google's sign-in. It is kept in LocalStorage and sent as an
 * `Authorization` header. Trade-off, stated plainly: a LocalStorage token can be read by any script running on this page, so a
 * cross-site-scripting bug would expose it. We accept that because the alternative (a cookie) is blocked as a third-party cookie
 * between our app and API sites, the app renders no user-supplied HTML, and the token only opens this person's Vault, never
 * Google. Signing out, or deleting the account, ends the session on the server too.
 */
const TOKEN_KEY = "gold-assistant:account-token";

export type AccountUser = { id: string; email: string; name: string; image: string | null };
export type AccountError = "network" | "rejected" | "rate_limited" | "unavailable";
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: AccountError };

// ---- the token, in this browser only ----
export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the person stays signed in until the tab closes, then is signed out */
  }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const errorFor = (status: number): AccountError =>
  status === 429 ? "rate_limited" : status === 503 || status >= 500 ? "unavailable" : "rejected";

// ---- calls to the Worker (each takes `fetchImpl` so tests never touch the network) ----
export async function fetchMe(token: string, fetchImpl: typeof fetch = fetch, base: string = API_BASE): Promise<Result<{ user: AccountUser }>> {
  try {
    const res = await fetchImpl(`${base}/me`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, error: errorFor(res.status) };
    const body = (await res.json().catch(() => null)) as { user?: Partial<AccountUser> } | null;
    const u = body?.user;
    if (!u || typeof u.id !== "string" || typeof u.email !== "string") return { ok: false, error: "unavailable" };
    return { ok: true, user: { id: u.id, email: u.email, name: typeof u.name === "string" ? u.name : "", image: typeof u.image === "string" ? u.image : null } };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Trade a Google ID token for a session. Returns the new bearer token and the account. */
export async function signInWithGoogle(
  idToken: string,
  fetchImpl: typeof fetch = fetch,
  base: string = API_BASE,
): Promise<Result<{ token: string; user: AccountUser }>> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: idToken } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const token = res.headers.get("set-auth-token");
  if (!res.ok || !token) return { ok: false, error: res.ok ? "unavailable" : errorFor(res.status) };
  const me = await fetchMe(token, fetchImpl, base);
  return me.ok ? { ok: true, token, user: me.user } : me;
}

async function call(path: string, method: "POST" | "DELETE", token: string, fetchImpl: typeof fetch, base: string): Promise<Result> {
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { ...bearer(token), "content-type": "application/json" },
      body: method === "POST" ? "{}" : null,
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: errorFor(res.status) };
  } catch {
    return { ok: false, error: "network" };
  }
}
export const signOutRemote = (token: string, fetchImpl: typeof fetch = fetch, base: string = API_BASE) => call("/api/auth/sign-out", "POST", token, fetchImpl, base);
export const deleteAccountRemote = (token: string, fetchImpl: typeof fetch = fetch, base: string = API_BASE) => call("/me", "DELETE", token, fetchImpl, base);

// ---- one shared signed-in state for the whole app ----
export type AccountState =
  | { status: "loading"; user: null }
  | { status: "signedOut"; user: null }
  | { status: "signedIn"; user: AccountUser }
  | { status: "unreachable"; user: null }; // a token is saved but the server could not be asked (offline): kept, tried again later

const SERVER_STATE: AccountState = { status: "loading", user: null };
let state: AccountState = SERVER_STATE;
let started = false;
const listeners = new Set<() => void>();
const set = (next: AccountState) => {
  state = next;
  listeners.forEach((l) => l());
};

/** Looks at the saved token once per page load. A token the server rejects is dropped quietly: the person is simply signed out. */
export async function startAccount(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (started) return;
  started = true;
  const token = readToken();
  if (!token) return set({ status: "signedOut", user: null });
  const me = await fetchMe(token, fetchImpl);
  if (me.ok) return set({ status: "signedIn", user: me.user });
  if (me.error === "rejected") {
    saveToken(null);
    return set({ status: "signedOut", user: null });
  }
  set({ status: "unreachable", user: null });
}

export async function signIn(idToken: string, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const r = await signInWithGoogle(idToken, fetchImpl);
  if (!r.ok) return r;
  saveToken(r.token);
  set({ status: "signedIn", user: r.user });
  return { ok: true };
}

/** Ends the session on the server (best effort) and here. Everything saved on this device stays. */
export async function signOut(fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = readToken();
  saveToken(null);
  set({ status: "signedOut", user: null });
  if (token) await signOutRemote(token, fetchImpl);
}

/** Deletes the account and everything stored for it on the server. Only on success is the person signed out here. */
export async function deleteAccount(fetchImpl: typeof fetch = fetch): Promise<Result> {
  const token = readToken();
  if (!token) return { ok: false, error: "rejected" };
  const r = await deleteAccountRemote(token, fetchImpl);
  if (r.ok) {
    saveToken(null);
    set({ status: "signedOut", user: null });
  }
  return r;
}

/** The current state, for code outside React (and for tests). Components use `useAccount()`. */
export const getAccountState = (): AccountState => state;

export function useAccount() {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => state,
    () => SERVER_STATE,
  );
  useEffect(() => void startAccount(), []);
  return { ...s, signIn, signOut, deleteAccount };
}

/** Test helper: forget everything, as a fresh page load would. */
export function resetAccountForTests(): void {
  state = SERVER_STATE;
  started = false;
  listeners.clear();
}

// ---- the preview gate (removed when sync ships in 4b.4) ----
const GATE_KEY = "gold-assistant:accounts";
/** Until Vault sync exists, signing in would promise something the app cannot yet do, so the block is shown only on request. */
export function accountsPreviewEnabled(search: string = typeof location === "undefined" ? "" : location.search): boolean {
  try {
    if (new URLSearchParams(search).get("accounts") === "1") localStorage.setItem(GATE_KEY, "1");
    if (new URLSearchParams(search).get("accounts") === "0") localStorage.removeItem(GATE_KEY);
    return localStorage.getItem(GATE_KEY) === "1";
  } catch {
    return false;
  }
}
