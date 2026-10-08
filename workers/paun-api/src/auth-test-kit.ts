import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer, testUtils } from "better-auth/plugins";
import { authOptions, type AuthFactory, type AuthLike } from "./auth";
import { testEnv } from "./test-kit";

/** Test-only helpers: the REAL auth library on an in-memory database, so tests can make real signed-in sessions without Google. */
export const accountEnv = (over: Record<string, string | undefined> = {}) =>
  testEnv({
    DATABASE_URL: "postgresql://not-used-in-tests",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12345",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    BETTER_AUTH_URL: "https://paun-api.paun-gold.workers.dev",
    ...over,
  } as never);

/** The slice of the library's test helpers used here (its own types are very heavy). */
export type TestHelpers = {
  createUser: (o: { email: string; name: string }) => unknown;
  saveUser: (u: unknown) => Promise<{ id: string }>;
  login: (o: { userId: string }) => Promise<{ cookies: { name: string; value: string }[] }>;
};

export async function memoryAuth(env = accountEnv()) {
  const db = { user: [], session: [], account: [], verification: [] };
  const closed: number[] = [];
  const auth = betterAuth({ ...authOptions(env), database: memoryAdapter(db), plugins: [bearer(), testUtils()] as never });
  const factory: AuthFactory = () => ({ auth: auth as unknown as AuthLike, close: async () => void closed.push(1) });
  const test = (await (auth as unknown as { $context: Promise<{ test: TestHelpers }> }).$context).test;
  /** Another signed-in person: their own user row and a bearer token for a fresh session. */
  const newSession = async (email: string, name: string) => {
    const user = await test.saveUser(test.createUser({ email, name }));
    const login = await test.login({ userId: user.id });
    const cookie = login.cookies.find((c) => c.name.includes("session_token"))!;
    return { user, bearerToken: decodeURIComponent(cookie.value) };
  };
  const first = await newSession("member@example.com", "Member One");
  return { env, factory, user: first.user, bearerToken: first.bearerToken, closed, db, newSession };
}
