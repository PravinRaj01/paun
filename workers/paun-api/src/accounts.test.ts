import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer, testUtils } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { handleAuthRoute, handleMe } from "./accounts";
import { authConfigured, authOptions, type AuthFactory, type AuthLike } from "./auth";
import { corsHeaders } from "./cors";
import { handle } from "./index";
import { testEnv } from "./test-kit";

const ORIGIN = "https://paun-web.paun-gold.workers.dev";
const NOW = new Date("2026-10-08T05:00:00Z");
const accountEnv = (over: Record<string, string | undefined> = {}) =>
  testEnv({
    DATABASE_URL: "postgresql://not-used-in-tests",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12345",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    BETTER_AUTH_URL: "https://paun-api.paun-gold.workers.dev",
    ...over,
  } as never);

/** The slice of the library's test helpers used here (its own types are very heavy). */
type TestHelpers = {
  createUser: (o: { email: string; name: string }) => unknown;
  saveUser: (u: unknown) => Promise<{ id: string }>;
  login: (o: { userId: string }) => Promise<{ cookies: { name: string; value: string }[] }>;
};

/** The real library on an in-memory database, with its test helpers, so tests can make a real signed-in session without Google. */
async function memoryAuth(env = accountEnv()) {
  const db = { user: [], session: [], account: [], verification: [] };
  const closed: number[] = [];
  const auth = betterAuth({ ...authOptions(env), database: memoryAdapter(db), plugins: [bearer(), testUtils()] as never });
  const factory: AuthFactory = () => ({ auth: auth as unknown as AuthLike, close: async () => void closed.push(1) });
  const test = (await (auth as unknown as { $context: Promise<{ test: TestHelpers }> }).$context).test;
  const user = await test.saveUser(test.createUser({ email: "member@example.com", name: "Member One" }));
  const login = await test.login({ userId: user.id });
  const cookie = login.cookies.find((c) => c.name.includes("session_token"))!;
  const bearerToken = decodeURIComponent(cookie.value);
  return { env, factory, user, bearerToken, closed, db };
}

const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`https://paun-api.paun-gold.workers.dev${path}`, { ...init, headers: { origin: ORIGIN, ...(init.headers ?? {}) } });
const cors = (env = accountEnv()) => corsHeaders(ORIGIN, env);

describe("which account routes exist (everything else the library offers stays unreachable)", () => {
  it.each(["/api/auth/list-sessions", "/api/auth/link-social", "/api/auth/change-email", "/api/auth/callback/google", "/api/auth/ok", "/api/auth/sign-up/email"])(
    "%s is 404",
    async (path) => {
      const { env, factory } = await memoryAuth();
      const res = await handleAuthRoute(req(path), env, cors(env), undefined, factory);
      expect(res.status).toBe(404);
    },
  );

  it("the wrong method on an allowed path is 405 and says which is allowed", async () => {
    const { env, factory } = await memoryAuth();
    const res = await handleAuthRoute(req("/api/auth/get-session", { method: "POST" }), env, cors(env), undefined, factory);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
  });
});

describe("guards", () => {
  it("another website's origin is refused", async () => {
    const { env, factory } = await memoryAuth();
    const res = await handleAuthRoute(req("/api/auth/get-session", { headers: { origin: "https://evil.example" } }), env, {}, undefined, factory);
    expect(res.status).toBe(403);
  });

  it("answers 503 accounts_not_configured until every secret and setting exists, and never touches the database", async () => {
    let created = 0;
    const factory: AuthFactory = () => ((created++), { auth: {} as AuthLike, close: async () => undefined });
    for (const env of [testEnv(), accountEnv({ DATABASE_URL: "" }), accountEnv({ BETTER_AUTH_SECRET: undefined }), accountEnv({ GOOGLE_CLIENT_SECRET: " " })]) {
      const res = await handleAuthRoute(req("/api/auth/get-session"), env, cors(env), undefined, factory);
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([503, "accounts_not_configured"]);
      expect((await handleMe(req("/me", { headers: { authorization: "Bearer x" } }), env, cors(env), undefined, factory)).status).toBe(503);
    }
    expect(created).toBe(0);
    expect(authConfigured(accountEnv())).toBe(true);
    expect(authConfigured(testEnv())).toBe(false);
  });

  it("sign-in accepts only a Google ID token (no token would start a redirect flow we have not set up)", async () => {
    const { env, factory } = await memoryAuth();
    const post = (body: unknown) =>
      handleAuthRoute(req("/api/auth/sign-in/social", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), env, cors(env), undefined, factory);
    for (const body of [{}, { provider: "google" }, { provider: "github", idToken: { token: "x".repeat(40) } }, { provider: "google", idToken: { token: "short" } }, { provider: "google", idToken: { token: 123 } }, { provider: "google", idToken: { token: "x".repeat(9000) } }]) {
      const res = await post(body);
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "invalid_request"]);
    }
    expect((await handleAuthRoute(req("/api/auth/sign-in/social", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } }), env, cors(env), undefined, factory)).status).toBe(400);
  });
});

describe("a signed-in session (real library, in-memory database)", () => {
  it("/me returns the account behind a valid bearer token, and nothing else about it", async () => {
    const { env, factory, user, bearerToken } = await memoryAuth();
    const res = await handleMe(req("/me", { headers: { authorization: `Bearer ${bearerToken}` } }), env, cors(env), undefined, factory);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: user.id, email: "member@example.com", name: "Member One", image: null } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["no Authorization header", {}],
    ["an empty bearer", { authorization: "Bearer " }],
    ["a made-up token", { authorization: "Bearer not-a-real-token.signature" }],
    ["a different scheme", { authorization: "Basic abc123" }],
  ])("/me is 401 with %s", async (_n, headers) => {
    const { env, factory } = await memoryAuth();
    const res = await handleMe(req("/me", { headers }), env, cors(env), undefined, factory);
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([401, "not_signed_in"]);
  });

  it("a token whose signature was tampered with is rejected", async () => {
    const { env, factory, bearerToken } = await memoryAuth();
    const tampered = bearerToken.slice(0, -4) + "AAAA";
    const res = await handleMe(req("/me", { headers: { authorization: `Bearer ${tampered}` } }), env, cors(env), undefined, factory);
    expect(res.status).toBe(401);
  });

  it("get-session works with the bearer token and lets the browser read the token header; no cookies are involved", async () => {
    const { env, factory, user, bearerToken } = await memoryAuth();
    const res = await handleAuthRoute(req("/api/auth/get-session", { headers: { authorization: `Bearer ${bearerToken}` } }), env, cors(env), undefined, factory);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(user.id);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-expose-headers")).toBe("set-auth-token");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull(); // bearer tokens, never credentialed cross-site requests
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("signing out ends the session: the same token no longer works", async () => {
    const { env, factory, bearerToken } = await memoryAuth();
    const headers = { authorization: `Bearer ${bearerToken}`, "content-type": "application/json" };
    const out = await handleAuthRoute(req("/api/auth/sign-out", { method: "POST", headers, body: "{}" }), env, cors(env), undefined, factory);
    expect(out.status).toBe(200);
    expect((await handleMe(req("/me", { headers }), env, cors(env), undefined, factory)).status).toBe(401);
  });

  it("closes the database connection after the response, through waitUntil when the platform gives one", async () => {
    const { env, factory, bearerToken, closed } = await memoryAuth();
    const pending: Promise<unknown>[] = [];
    await handleMe(req("/me", { headers: { authorization: `Bearer ${bearerToken}` } }), env, cors(env), { waitUntil: (p) => void pending.push(p) }, factory);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(closed).toHaveLength(1);
    await handleMe(req("/me", { headers: { authorization: `Bearer ${bearerToken}` } }), env, cors(env), undefined, factory); // no waitUntil: closed before returning
    expect(closed).toHaveLength(2);
  });
});

describe("wired into the Worker", () => {
  it("the browser's permission check allows the Authorization header", async () => {
    const res = await handle(new Request("https://x/me", { method: "OPTIONS", headers: { origin: ORIGIN } }), accountEnv(), NOW);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("/me and /api/auth/* are routed (503 here only because no database is set)", async () => {
    const env = testEnv();
    expect((await handle(req("/me", { headers: { authorization: "Bearer x" } }), env, NOW)).status).toBe(503);
    expect((await handle(req("/api/auth/get-session"), env, NOW)).status).toBe(503);
    expect((await handle(req("/me", { method: "POST" }), env, NOW)).status).toBe(405);
  });
});
