import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountsPreviewEnabled,
  deleteAccount,
  fetchMe,
  readToken,
  resetAccountForTests,
  saveToken,
  signIn,
  signInWithGoogle,
  getAccountState,
  signOut,
  startAccount,
  type AccountState,
} from "./account";

const USER = { id: "u1", email: "member@example.com", name: "Member One", image: "https://example.com/p.png" };
const BASE = "https://api.test";
const me = (over: object = {}) => new Response(JSON.stringify({ user: { ...USER, ...over } }), { status: 200 });
const withToken = (body: BodyInit | null, token: string, status = 200) => new Response(body, { status, headers: { "set-auth-token": token } });

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  resetAccountForTests();
});
afterEach(() => vi.unstubAllGlobals());

/** A fake fetch that answers by "METHOD path" and records every call. */
const fakeApi = (routes: Record<string, () => Response | Error>) => {
  const calls: { key: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    calls.push({ key, init });
    const r = routes[key];
    if (!r) throw new Error(`unexpected ${key}`);
    const out = r();
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe("the token in this browser", () => {
  it("is saved, read back and removed", () => {
    expect(readToken()).toBeNull();
    saveToken("abc.def");
    expect(readToken()).toBe("abc.def");
    saveToken(null);
    expect(readToken()).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    vi.stubGlobal("localStorage", blocked);
    expect(() => saveToken("x")).not.toThrow();
    expect(readToken()).toBeNull();
  });
});

describe("signInWithGoogle (trading Google's ID token for a session)", () => {
  const post = "POST /api/auth/sign-in/social";

  it("sends the ID token to the Worker in the body (never the URL) and returns the bearer token and the account", async () => {
    const api = fakeApi({ [post]: () => withToken("{}", "session.signature"), "GET /me": () => me() });
    const r = await signInWithGoogle("google-id-token-value", api.impl, BASE);
    expect(r).toEqual({ ok: true, token: "session.signature", user: USER });
    const sent = api.calls.find((c) => c.key === post)!;
    expect(JSON.parse(String(sent.init.body))).toEqual({ provider: "google", idToken: { token: "google-id-token-value" } });
    expect(JSON.stringify(api.calls)).not.toContain("session.signature\"?");
    const meCall = api.calls.find((c) => c.key === "GET /me")!;
    expect(new Headers(meCall.init.headers).get("authorization")).toBe("Bearer session.signature");
  });

  it.each([
    ["the Worker refuses the token (401)", 401, "rejected"],
    ["the Worker refuses the request (400)", 400, "rejected"],
    ["too many attempts (429)", 429, "rate_limited"],
    ["accounts are not set up (503)", 503, "unavailable"],
    ["a server error (500)", 500, "unavailable"],
  ])("%s", async (_n, status, error) => {
    const api = fakeApi({ [post]: () => new Response("{}", { status }) });
    expect(await signInWithGoogle("t", api.impl, BASE)).toEqual({ ok: false, error });
  });

  it("an answer without the session token is not a sign-in", async () => {
    const api = fakeApi({ [post]: () => new Response("{}", { status: 200 }) });
    expect(await signInWithGoogle("t", api.impl, BASE)).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports a network failure", async () => {
    const api = fakeApi({ [post]: () => new TypeError("fetch failed") });
    expect(await signInWithGoogle("t", api.impl, BASE)).toEqual({ ok: false, error: "network" });
  });
});

describe("fetchMe", () => {
  it("rejects an answer that is not an account", async () => {
    for (const body of [{}, { user: {} }, { user: { id: 5, email: "x" } }]) {
      const api = fakeApi({ "GET /me": () => new Response(JSON.stringify(body)) });
      expect(await fetchMe("t", api.impl, BASE)).toEqual({ ok: false, error: "unavailable" });
    }
  });

  it("tolerates a missing name or photo", async () => {
    const api = fakeApi({ "GET /me": () => new Response(JSON.stringify({ user: { id: "a", email: "b@c.d" } })) });
    expect(await fetchMe("t", api.impl, BASE)).toEqual({ ok: true, user: { id: "a", email: "b@c.d", name: "", image: null } });
  });
});

describe("the shared signed-in state", () => {
  it("with no saved token the person is signed out, and nothing is asked of the server", async () => {
    const api = fakeApi({});
    await startAccount(api.impl);
    expect(api.calls).toHaveLength(0);
    expect(await currentState()).toMatchObject({ status: "signedOut" });
  });

  it("a saved token the server accepts signs the person in", async () => {
    saveToken("good.token");
    await startAccount(fakeApi({ "GET /me": () => me() }).impl);
    expect(await currentState()).toMatchObject({ status: "signedIn", user: USER });
  });

  it("a token the server rejects is dropped quietly, and the person is signed out", async () => {
    saveToken("stale.token");
    await startAccount(fakeApi({ "GET /me": () => new Response("{}", { status: 401 }) }).impl);
    expect(await currentState()).toMatchObject({ status: "signedOut" });
    expect(readToken()).toBeNull();
  });

  it("when the server cannot be reached the token is KEPT (offline is not signed out)", async () => {
    saveToken("good.token");
    await startAccount(fakeApi({ "GET /me": () => new TypeError("offline") }).impl);
    expect(await currentState()).toMatchObject({ status: "unreachable" });
    expect(readToken()).toBe("good.token");
  });

  it("signIn saves the token and the account; a failed sign-in changes nothing", async () => {
    const ok = fakeApi({ "POST /api/auth/sign-in/social": () => withToken("{}", "new.token"), "GET /me": () => me() });
    expect(await signIn("idtok", ok.impl)).toEqual({ ok: true });
    expect(readToken()).toBe("new.token");
    resetAccountForTests();
    store.clear();
    const bad = fakeApi({ "POST /api/auth/sign-in/social": () => new Response("{}", { status: 401 }) });
    expect(await signIn("idtok", bad.impl)).toEqual({ ok: false, error: "rejected" });
    expect(readToken()).toBeNull();
  });

  it("signing out forgets the token here at once and ends the session on the server", async () => {
    saveToken("good.token");
    const api = fakeApi({ "POST /api/auth/sign-out": () => new Response("{}") });
    await signOut(api.impl);
    expect(readToken()).toBeNull();
    expect(await currentState()).toMatchObject({ status: "signedOut" });
    expect(new Headers(api.calls[0]!.init.headers).get("authorization")).toBe("Bearer good.token");
  });

  it("signing out works even if the server cannot be reached (the token is gone either way)", async () => {
    saveToken("good.token");
    await signOut(fakeApi({ "POST /api/auth/sign-out": () => new TypeError("offline") }).impl);
    expect(readToken()).toBeNull();
  });

  it("deleting the account signs the person out ONLY when the server confirms it", async () => {
    saveToken("good.token");
    expect(await deleteAccount(fakeApi({ "DELETE /me": () => new Response("{}", { status: 500 }) }).impl)).toEqual({ ok: false, error: "unavailable" });
    expect(readToken()).toBe("good.token"); // not deleted, so still signed in: they can try again
    expect(await deleteAccount(fakeApi({ "DELETE /me": () => new Response('{"ok":true}') }).impl)).toEqual({ ok: true });
    expect(readToken()).toBeNull();
    expect(await currentState()).toMatchObject({ status: "signedOut" });
  });

  it("deleting without a session asks the server for nothing", async () => {
    const api = fakeApi({});
    expect(await deleteAccount(api.impl)).toEqual({ ok: false, error: "rejected" });
    expect(api.calls).toHaveLength(0);
  });
});

describe("the preview gate (until Vault sync ships)", () => {
  it("is off by default, switched on and remembered by ?accounts=1, and off again by ?accounts=0", () => {
    expect(accountsPreviewEnabled("")).toBe(false);
    expect(accountsPreviewEnabled("?accounts=1")).toBe(true);
    expect(accountsPreviewEnabled("")).toBe(true); // remembered
    expect(accountsPreviewEnabled("?accounts=0")).toBe(false);
    expect(accountsPreviewEnabled("")).toBe(false);
  });

  it("is simply off when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    vi.stubGlobal("localStorage", blocked);
    expect(accountsPreviewEnabled("?accounts=1")).toBe(false);
  });
});

const currentState = async (): Promise<AccountState> => getAccountState();
