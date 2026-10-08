import { Pool } from "@neondatabase/serverless";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins";
import { PostgresDialect, type PostgresDialectConfig } from "kysely";
import { isAllowedOrigin } from "./cors";
import type { Env } from "./env";

/**
 * Optional accounts (PLAN.md 4b). Better Auth runs inside this Worker, with its tables in Neon Postgres.
 *
 * How sign-in works (no cookies, no redirects):
 *   1. The page shows Google's own "Sign in with Google" button. Google hands the page a signed ID token.
 *   2. The page POSTs it to /api/auth/sign-in/social. Better Auth checks Google's signature and that the token was issued for OUR
 *      client id, then creates (or finds) the user and a session.
 *   3. The `bearer` plugin returns the session token in a `set-auth-token` response header. The page keeps it and sends it as
 *      `Authorization: Bearer ...` on later calls. Nothing depends on third-party cookies, which browsers increasingly block
 *      (the app and this API are different sites, because workers.dev is a public suffix).
 * Only Google sign-in exists for now: email and password are off, and no other provider is configured.
 */
/** The only two things our routes use from the library, so the rest of its large type surface stays out of our code. */
export type AuthLike = {
  handler: (request: Request) => Promise<Response>;
  api: { getSession: (ctx: { headers: Headers }) => Promise<{ user: { id: string; email: string; name: string; image?: string | null } } | null> };
};
export type AuthHandle = { auth: AuthLike; close: () => Promise<void> };
export type AuthFactory = (env: Env) => AuthHandle;

/** The options every environment shares. Tests add a memory database (and test helpers) on top; production adds Neon. */
export function authOptions(env: Env): BetterAuthOptions {
  return {
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID ?? "", clientSecret: env.GOOGLE_CLIENT_SECRET ?? "" },
    },
    emailAndPassword: { enabled: false },
    // we only need to know WHO someone is: keep Google's own tokens out of the database in readable form
    account: { encryptOAuthTokens: true },
    plugins: [bearer()],
    // the same allow-list the rest of the API uses: the live app, its branch previews, and localhost
    trustedOrigins: (request) => {
      const origin = request?.headers.get("origin") ?? null;
      return isAllowedOrigin(origin, env) ? [origin] : [];
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  };
}

/**
 * One connection pool per request: a Worker cannot keep a database socket alive between requests, so open it here and let the
 * caller close it once the response is on its way (`ctx.waitUntil(handle.close())`).
 */
export const createAuth: AuthFactory = (env) => {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  // Neon's Pool is the standard `pg` Pool over a WebSocket; Kysely's type for it is just stricter than it needs to be
  const dialect = new PostgresDialect({ pool: pool as unknown as PostgresDialectConfig["pool"] });
  return {
    auth: betterAuth({ ...authOptions(env), database: { dialect, type: "postgres" } }) as unknown as AuthLike,
    close: () => pool.end().catch(() => undefined),
  };
};

/** True when everything accounts need is configured; otherwise the account routes answer 503 instead of failing strangely. */
export const authConfigured = (env: Env) =>
  Boolean(env.DATABASE_URL?.trim() && env.BETTER_AUTH_SECRET?.trim() && env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim() && env.BETTER_AUTH_URL?.trim());
