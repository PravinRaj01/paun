import { authConfigured, createAuth, type AuthFactory } from "./auth";
import { isAllowedOrigin } from "./cors";
import type { Env, ExecutionContextLike } from "./env";
import { json } from "./http";
import { allowHourly } from "./rate";

/**
 * The account routes (PLAN.md 4b). Only what the app needs is reachable: the library has many more endpoints (linking accounts,
 * listing sessions, changing email, ...) and every one of them would be attack surface we do not use.
 *
 *   POST   /api/auth/sign-in/social   sign in with a Google ID token (no redirect flow)
 *   GET    /api/auth/get-session      the session behind a bearer token
 *   POST   /api/auth/sign-out         end it
 *   GET    /me                        who am I (the account's id, email, name, photo), or 401
 *   DELETE /me                        delete my account and everything stored for it
 */
const ALLOWED: Record<string, "GET" | "POST"> = {
  "/api/auth/sign-in/social": "POST",
  "/api/auth/get-session": "GET",
  "/api/auth/sign-out": "POST",
};

/** Per visitor per hour. Sign-in needs a valid Google token anyway; this just stops a script hammering the database. */
export const SIGN_IN_PER_HOUR = 30;
export const DELETE_PER_HOUR = 5;

/** The browser may read the session token the bearer plugin returns in this header. */
const withExposed = (cors: Record<string, string>) => ({ ...cors, "access-control-expose-headers": "set-auth-token" });

export async function withAuth<T>(env: Env, ctx: ExecutionContextLike | undefined, factory: AuthFactory, run: (h: ReturnType<AuthFactory>) => Promise<T>): Promise<T> {
  const handle = factory(env);
  try {
    return await run(handle);
  } finally {
    // close the database connection after the response has gone out
    if (ctx) ctx.waitUntil(handle.close());
    else await handle.close();
  }
}

export async function handleAuthRoute(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  ctx?: ExecutionContextLike,
  factory: AuthFactory = createAuth,
  now: Date = new Date(),
): Promise<Response> {
  const headers = withExposed(cors);
  const path = new URL(request.url).pathname;
  const method = ALLOWED[path];
  if (!method) return json({ error: "not_found" }, 404, headers);
  if (request.method !== method) return json({ error: "method_not_allowed" }, 405, { ...headers, allow: `${method}, OPTIONS` });
  if (!isAllowedOrigin(request.headers.get("origin"), env)) return json({ error: "forbidden_origin" }, 403, headers);
  if (!authConfigured(env)) return json({ error: "accounts_not_configured" }, 503, headers);

  if (path === "/api/auth/sign-in/social") {
    // Only the Google ID-token flow is supported. Without a token the library would start a redirect flow we have not set up.
    const body = (await request.clone().json().catch(() => null)) as { provider?: unknown; idToken?: { token?: unknown } } | null;
    if (body?.provider !== "google" || typeof body.idToken?.token !== "string" || body.idToken.token.length < 20 || body.idToken.token.length > 8192) {
      return json({ error: "invalid_request" }, 400, headers);
    }
    if (!(await allowHourly(env.SPOT, "signin", request.headers.get("cf-connecting-ip"), SIGN_IN_PER_HOUR, now))) {
      return json({ error: "rate_limited" }, 429, headers);
    }
  }

  return withAuth(env, ctx, factory, async ({ auth }) => {
    const res = await auth.handler(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    out.headers.set("cache-control", "no-store");
    return out;
  });
}

/** Who is signed in. Never cached; 401 without a valid bearer token. */
export async function handleMe(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  ctx?: ExecutionContextLike,
  factory: AuthFactory = createAuth,
): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"), env)) return json({ error: "forbidden_origin" }, 403, cors);
  if (!authConfigured(env)) return json({ error: "accounts_not_configured" }, 503, cors);
  if (!/^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "")) return json({ error: "not_signed_in" }, 401, cors);
  return withAuth(env, ctx, factory, async ({ auth }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: "not_signed_in" }, 401, cors);
    const { id, email, name, image } = session.user;
    return json({ user: { id, email, name, image: image ?? null } }, 200, cors);
  });
}

/**
 * Delete the signed-in account and everything stored for it: the user, their sessions and their linked sign-in. (From phase 4b.4 the
 * synced data goes with it, through `on delete cascade`.) The token in this very request is the proof of who is asking.
 * Nothing on the visitor's own device is touched.
 */
export async function handleDeleteMe(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  ctx?: ExecutionContextLike,
  factory: AuthFactory = createAuth,
  now: Date = new Date(),
): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"), env)) return json({ error: "forbidden_origin" }, 403, cors);
  if (!authConfigured(env)) return json({ error: "accounts_not_configured" }, 503, cors);
  if (!/^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "")) return json({ error: "not_signed_in" }, 401, cors);
  if (!(await allowHourly(env.SPOT, "delete", request.headers.get("cf-connecting-ip"), DELETE_PER_HOUR, now))) {
    return json({ error: "rate_limited" }, 429, cors);
  }
  return withAuth(env, ctx, factory, async ({ auth }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: "not_signed_in" }, 401, cors);
    await (await auth.$context).internalAdapter.deleteUser(session.user.id);
    console.log("account: deleted"); // no id, no email: nothing about the person goes into a log
    return json({ ok: true }, 200, cors);
  });
}
