import { withAuth } from "../accounts";
import { authConfigured, createAuth, type AuthFactory } from "../auth";
import { isAllowedOrigin } from "../cors";
import type { Env, ExecutionContextLike } from "../env";
import { json } from "../http";
import { allowHourly } from "../rate";
import { createVaultStore, LimitExceeded, type VaultStoreFactory } from "./store";
import { MAX_BODY_CHARS, MAX_ITEMS, SYNC_PER_HOUR, validateSyncBody, type Removal, type SyncItem } from "./validate";

/**
 * POST /sync  { since: number, items: [...], removed: [{ id, deletedAt }] }   with  Authorization: Bearer <session>
 *
 * One call does both halves: it applies what the device changed (newest change per piece wins; a removal cannot be undone by an older
 * copy), then answers with everything that changed on the server after `since`, plus the new `version` to ask from next time.
 * Everything is scoped to the signed-in account: the account id comes from the session, never from the request.
 */
export type SyncResponse = { ok: true; version: number; items: SyncItem[]; removed: Removal[] };

export async function handleSync(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  ctx?: ExecutionContextLike,
  authFactory: AuthFactory = createAuth,
  storeFactory: VaultStoreFactory = createVaultStore,
  now: Date = new Date(),
): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"), env)) return json({ error: "forbidden_origin" }, 403, cors);
  if (!authConfigured(env)) return json({ error: "accounts_not_configured" }, 503, cors);
  if (!/^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "")) return json({ error: "not_signed_in" }, 401, cors);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return json({ error: "too_large" }, 413, cors);

  // who is asking: the account id comes from the session, never from anything in the request body
  const session = await withAuth(env, ctx, authFactory, ({ auth }) => auth.api.getSession({ headers: request.headers }));
  if (!session) return json({ error: "not_signed_in" }, 401, cors);
  const userId = session.user.id;

  if (!(await allowHourly(env.SPOT, "sync", userId, SYNC_PER_HOUR, now))) return json({ error: "rate_limited" }, 429, cors);

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413, cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request", field: "body" }, 400, cors);
  }
  const checked = validateSyncBody(raw, now);
  if (!checked.ok) return json({ error: "invalid_request", field: checked.field }, 400, cors);
  const { since, items, removed } = checked.value;

  const handle = storeFactory(env);
  try {
    try {
      await handle.store.apply(userId, items, removed, MAX_ITEMS);
    } catch (e) {
      if (e instanceof LimitExceeded) return json({ error: "too_many_items", max: MAX_ITEMS }, 413, cors);
      throw e;
    }
    const rows = await handle.store.changedSince(userId, since);
    const body: SyncResponse = {
      ok: true,
      version: rows.reduce((top, r) => Math.max(top, r.version), since),
      items: rows.filter((r) => r.deletedAt === null).map((r) => ({ id: r.id, name: r.name, weight: r.weight, purity: r.purity, paidUsd: r.paidUsd, date: r.date, updatedAt: r.updatedAt })),
      removed: rows.filter((r) => r.deletedAt !== null).map((r) => ({ id: r.id, deletedAt: r.deletedAt! })),
    };
    console.log(`sync: ${items.length} in, ${removed.length} removed in, ${body.items.length} out`); // counts only: never ids, names or the account
    return json(body, 200, cors);
  } catch {
    console.log("sync: failed");
    return json({ error: "sync_failed" }, 502, cors);
  } finally {
    if (ctx) ctx.waitUntil(handle.close());
    else await handle.close();
  }
}
