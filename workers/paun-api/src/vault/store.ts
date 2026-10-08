import { Pool } from "@neondatabase/serverless";
import type { Env } from "../env";
import type { PurityId } from "../scan/purity";
import type { Removal, SyncItem } from "./validate";

/**
 * Where an account's synced pieces live. One interface, two implementations: Postgres (Neon) for real, and an in-memory one for tests.
 * They share a single set of scenarios (`scenarios.ts`), so the database is held to exactly the same rules as the tests.
 *
 * The merge rule, per piece id: an incoming change is applied only when its `updatedAt` is NEWER than what is stored. So the newest
 * change wins, a removal (a tombstone) is just a change that cannot be undone by an older copy, and applying the same batch twice does
 * nothing the second time (an equal time never wins, so nothing is re-versioned and nothing is sent back needlessly).
 */
export type StoredRow = {
  id: string;
  name: string;
  weight: number;
  purity: PurityId;
  paidUsd: number;
  date: string;
  updatedAt: string;
  deletedAt: string | null; // set = the piece was removed (a tombstone)
  version: number; // grows with every change; a device asks for "everything after version N"
};

export class LimitExceeded extends Error {}

export interface VaultStore {
  /** Apply a batch all-or-nothing. Throws LimitExceeded (and applies nothing) if the account would end up with more than `max` live pieces. */
  apply(userId: string, items: SyncItem[], removed: Removal[], max: number): Promise<void>;
  /** Every row (pieces and tombstones) changed after `since`, oldest change first. */
  changedSince(userId: string, since: number): Promise<StoredRow[]>;
}
export type VaultStoreHandle = { store: VaultStore; close: () => Promise<void> };
export type VaultStoreFactory = (env: Env) => VaultStoreHandle;

const newer = (incoming: string, existing: string) => Date.parse(incoming) > Date.parse(existing);

// ---------- in memory (tests) ----------
export class MemoryVaultStore implements VaultStore {
  private rows = new Map<string, Map<string, StoredRow>>();
  private counter = 0;
  private userRows(userId: string) {
    let m = this.rows.get(userId);
    if (!m) this.rows.set(userId, (m = new Map()));
    return m;
  }

  async apply(userId: string, items: SyncItem[], removed: Removal[], max: number): Promise<void> {
    const mine = this.userRows(userId);
    const snapshot = new Map([...mine].map(([k, v]) => [k, { ...v }]));
    const startCounter = this.counter;
    for (const it of items) {
      const have = mine.get(it.id);
      if (!have || newer(it.updatedAt, have.updatedAt)) mine.set(it.id, { ...it, deletedAt: null, version: ++this.counter });
    }
    for (const rm of removed) {
      const have = mine.get(rm.id);
      if (!have) mine.set(rm.id, { id: rm.id, name: "", weight: 0, purity: "999.9", paidUsd: 0, date: "1970-01-01", updatedAt: rm.deletedAt, deletedAt: rm.deletedAt, version: ++this.counter });
      else if (newer(rm.deletedAt, have.updatedAt)) mine.set(rm.id, { ...have, updatedAt: rm.deletedAt, deletedAt: rm.deletedAt, version: ++this.counter });
    }
    if ([...mine.values()].filter((r) => r.deletedAt === null).length > max) {
      this.rows.set(userId, snapshot);
      this.counter = startCounter;
      throw new LimitExceeded();
    }
  }

  async changedSince(userId: string, since: number): Promise<StoredRow[]> {
    return [...this.userRows(userId).values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version).map((r) => ({ ...r }));
  }
}

// ---------- Postgres (Neon) ----------
type Db = { query: Pool["query"] };
const ITEM_UPSERT = `
insert into vault_items (user_id, id, name, weight, purity, paid_usd, date, updated_at, deleted_at, version)
select $1, t.id, t.name, t.weight, t.purity, t.paid_usd, t.date, t.updated_at, null, nextval('vault_version_seq')
from unnest($2::text[], $3::text[], $4::float8[], $5::text[], $6::float8[], $7::text[], $8::timestamptz[])
  as t(id, name, weight, purity, paid_usd, date, updated_at)
on conflict (user_id, id) do update set
  name = excluded.name, weight = excluded.weight, purity = excluded.purity, paid_usd = excluded.paid_usd, date = excluded.date,
  updated_at = excluded.updated_at, deleted_at = null, version = nextval('vault_version_seq')
where vault_items.updated_at < excluded.updated_at`;
const TOMBSTONE_UPSERT = `
insert into vault_items (user_id, id, name, weight, purity, paid_usd, date, updated_at, deleted_at, version)
select $1, t.id, '', 0, '999.9', 0, '1970-01-01', t.deleted_at, t.deleted_at, nextval('vault_version_seq')
from unnest($2::text[], $3::timestamptz[]) as t(id, deleted_at)
on conflict (user_id, id) do update set
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, version = nextval('vault_version_seq')
where vault_items.updated_at < excluded.updated_at`;

export class PgVaultStore implements VaultStore {
  constructor(private pool: Pool) {}

  async apply(userId: string, items: SyncItem[], removed: Removal[], max: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (items.length) {
        await client.query(ITEM_UPSERT, [
          userId,
          items.map((i) => i.id),
          items.map((i) => i.name),
          items.map((i) => i.weight),
          items.map((i) => i.purity),
          items.map((i) => i.paidUsd),
          items.map((i) => i.date),
          items.map((i) => i.updatedAt),
        ]);
      }
      if (removed.length) await client.query(TOMBSTONE_UPSERT, [userId, removed.map((r) => r.id), removed.map((r) => r.deletedAt)]);
      const live = await client.query<{ n: number }>("select count(*)::int as n from vault_items where user_id = $1 and deleted_at is null", [userId]);
      if ((live.rows[0]?.n ?? 0) > max) {
        await client.query("rollback");
        throw new LimitExceeded();
      }
      await client.query("commit");
    } catch (e) {
      if (!(e instanceof LimitExceeded)) await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async changedSince(userId: string, since: number): Promise<StoredRow[]> {
    const r = await (this.pool as unknown as Db).query<{
      id: string; name: string; weight: number; purity: PurityId; paidUsd: number; date: string; updated_at: Date; deleted_at: Date | null; version: number;
    }>(
      `select id, name, weight, purity, paid_usd as "paidUsd", date, updated_at, deleted_at, version::float8 as version
       from vault_items where user_id = $1 and version > $2 order by version`,
      [userId, since],
    );
    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      weight: x.weight,
      purity: x.purity,
      paidUsd: x.paidUsd,
      date: x.date,
      updatedAt: new Date(x.updated_at).toISOString(),
      deletedAt: x.deleted_at ? new Date(x.deleted_at).toISOString() : null,
      version: Number(x.version),
    }));
  }
}

/** One database connection per request, closed after the response (a Worker cannot keep a socket between requests). */
export const createVaultStore: VaultStoreFactory = (env) => {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { store: new PgVaultStore(pool), close: () => pool.end().catch(() => undefined) };
};
