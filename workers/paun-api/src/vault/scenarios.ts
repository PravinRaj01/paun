import { LimitExceeded, type VaultStore } from "./store";
import type { Removal, SyncItem } from "./validate";

/** Minimal assertions with no dependencies, so this file runs in the unit tests and in a plain script alike. */
/** JSON with the keys of every object sorted, so two equal values compare equal whatever order a database returned the keys in
 *  (Postgres `jsonb` stores keys in its own order). */
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)])) : v;
const show = (v: unknown) => JSON.stringify(canonical(v));
const assert = {
  equal: (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
  },
  ok: (value: unknown, message = "expected a truthy value") => {
    if (!value) throw new Error(message);
  },
  deepEqual: (actual: unknown, expected: unknown) => {
    if (show(actual) !== show(expected)) throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
  },
  rejects: async (promise: Promise<unknown>, type: new (...a: never[]) => Error) => {
    try {
      await promise;
    } catch (e) {
      if (e instanceof type) return;
      throw e;
    }
    throw new Error("expected the call to be rejected");
  },
};

/**
 * The rules every VaultStore must obey. Run by the unit tests against the in-memory store AND by a one-off script against the real
 * Neon database, so the two cannot drift apart.
 */
export const piece = (id: string, over: Partial<SyncItem> = {}): SyncItem => ({
  id,
  name: `piece ${id}`,
  weight: 10,
  purity: "916",
  paidUsd: 500,
  date: "2026-10-01",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
export const gone = (id: string, deletedAt = "2026-10-05T00:00:00.000Z"): Removal => ({ id, deletedAt });
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const MAX = 50;

const prefsOf = (language: "en" | "ms", at: string) => ({ value: { language, decimals: 2 }, updatedAt: at });
const listOf = (rate: number, at: string) => ({
  value: { countries: [{ id: "my", name: "Malaysia", currency: "MYR", rate, duty: 0, tax: 0, premium: 6 }], excluded: ["sg"] },
  updatedAt: at,
});

export type Scenario = { name: string; run: (store: VaultStore, a: string, b: string) => Promise<void> };

export const scenarios: Scenario[] = [
  {
    name: "a stored piece comes back from changedSince(0), and not after its own version",
    run: async (s, a) => {
      await s.apply(a, [piece("p1")], [], MAX);
      const rows = await s.changedSince(a, 0);
      assert.equal(rows.length, 1);
      assert.deepEqual({ id: rows[0]!.id, name: rows[0]!.name, weight: rows[0]!.weight, purity: rows[0]!.purity, paidUsd: rows[0]!.paidUsd, date: rows[0]!.date, deletedAt: rows[0]!.deletedAt }, { id: "p1", name: "piece p1", weight: 10, purity: "916", paidUsd: 500, date: "2026-10-01", deletedAt: null });
      assert.equal(rows[0]!.updatedAt, "2026-10-01T00:00:00.000Z");
      assert.deepEqual(await s.changedSince(a, rows[0]!.version), []);
    },
  },
  {
    name: "an older change is ignored, a newer one wins and gets a new version",
    run: async (s, a) => {
      await s.apply(a, [piece("p1", { name: "v2", updatedAt: at(5) })], [], MAX);
      const v1 = (await s.changedSince(a, 0))[0]!;
      await s.apply(a, [piece("p1", { name: "older", updatedAt: at(3) })], [], MAX);
      assert.equal((await s.changedSince(a, 0))[0]!.name, "v2");
      await s.apply(a, [piece("p1", { name: "v3", updatedAt: at(7) })], [], MAX);
      const v3 = (await s.changedSince(a, 0))[0]!;
      assert.equal(v3.name, "v3");
      assert.ok(v3.version > v1.version);
    },
  },
  {
    name: "applying the same batch twice changes nothing the second time (no new version, nothing re-sent)",
    run: async (s, a) => {
      const batch = [piece("p1"), piece("p2", { updatedAt: at(2) })];
      await s.apply(a, batch, [gone("p3")], MAX);
      const first = await s.changedSince(a, 0);
      await s.apply(a, batch, [gone("p3")], MAX);
      assert.deepEqual(await s.changedSince(a, 0), first);
      const top = Math.max(...first.map((r) => r.version));
      assert.deepEqual(await s.changedSince(a, top), []);
    },
  },
  {
    name: "a removal is a tombstone that an older copy cannot undo",
    run: async (s, a) => {
      await s.apply(a, [piece("p1", { updatedAt: at(1) })], [], MAX);
      await s.apply(a, [], [gone("p1", at(4))], MAX);
      const row = (await s.changedSince(a, 0)).find((r) => r.id === "p1")!;
      assert.equal(row.deletedAt, at(4));
      // another device that was offline sends its old copy of the piece
      await s.apply(a, [piece("p1", { updatedAt: at(2) })], [], MAX);
      assert.equal((await s.changedSince(a, 0)).find((r) => r.id === "p1")!.deletedAt, at(4));
    },
  },
  {
    name: "a removal for a piece the server never saw is still kept (so it cannot appear later)",
    run: async (s, a) => {
      await s.apply(a, [], [gone("ghost", at(6))], MAX);
      const row = (await s.changedSince(a, 0)).find((r) => r.id === "ghost")!;
      assert.equal(row.deletedAt, at(6));
      await s.apply(a, [piece("ghost", { updatedAt: at(2) })], [], MAX);
      assert.equal((await s.changedSince(a, 0)).find((r) => r.id === "ghost")!.deletedAt, at(6));
    },
  },
  {
    name: "two accounts never see each other's pieces, even with the same piece id",
    run: async (s, a, b) => {
      await s.apply(a, [piece("same", { name: "mine" })], [], MAX);
      await s.apply(b, [piece("same", { name: "theirs" })], [], MAX);
      assert.equal((await s.changedSince(a, 0)).find((r) => r.id === "same")!.name, "mine");
      assert.equal((await s.changedSince(b, 0)).find((r) => r.id === "same")!.name, "theirs");
      await s.apply(b, [], [gone("same")], MAX);
      assert.equal((await s.changedSince(a, 0)).find((r) => r.id === "same")!.deletedAt, null);
    },
  },
  {
    name: "the union of two devices is kept (first sign-in): nothing is lost, nothing is duplicated",
    run: async (s, a) => {
      await s.apply(a, [piece("d1-a"), piece("d1-b")], [], MAX); // the account already had two pieces
      await s.apply(a, [piece("d2-a"), piece("d1-b", { name: "same piece again" })], [], MAX); // a second device brings two, one the same id
      const live = (await s.changedSince(a, 0)).filter((r) => r.deletedAt === null).map((r) => r.id).sort();
      assert.deepEqual(live, ["d1-a", "d1-b", "d2-a"]);
    },
  },
  {
    name: "a device asking 'since N' gets only what changed after N, including removals",
    run: async (s, a) => {
      await s.apply(a, [piece("x1"), piece("x2")], [], MAX);
      const mark = Math.max(...(await s.changedSince(a, 0)).map((r) => r.version));
      await s.apply(a, [piece("x3")], [gone("x1", at(9))], MAX);
      const after = await s.changedSince(a, mark);
      assert.deepEqual(after.map((r) => [r.id, r.deletedAt !== null]).sort(), [["x1", true], ["x3", false]]);
    },
  },
  {
    name: "going over the limit applies NOTHING from the batch (all or nothing)",
    run: async (s, a) => {
      await s.apply(a, [piece("k1"), piece("k2")], [], 3);
      await assert.rejects(s.apply(a, [piece("k3"), piece("k4"), piece("k5")], [gone("k1", at(8))], 3), LimitExceeded);
      const rows = await s.changedSince(a, 0);
      assert.deepEqual(rows.map((r) => r.id).sort(), ["k1", "k2"]);
      assert.equal(rows.find((r) => r.id === "k1")!.deletedAt, null); // the removal in the failed batch was not applied either
    },
  },
  {
    name: "removed pieces do not count against the limit",
    run: async (s, a) => {
      await s.apply(a, [piece("m1"), piece("m2"), piece("m3")], [], 3);
      await s.apply(a, [], [gone("m1", at(8)), gone("m2", at(8))], 3);
      await s.apply(a, [piece("m4"), piece("m5")], [], 3); // 3 live: m3, m4, m5
      assert.equal((await s.changedSince(a, 0)).filter((r) => r.deletedAt === null).length, 3);
    },
  },
  {
    name: "settings: none at first, and the first save is kept whole",
    run: async (s, a) => {
      assert.deepEqual(await s.getPrefs(a), { prefs: null, watchlist: null });
      await s.applyPrefs(a, prefsOf("ms", at(3)), listOf(4.5, at(3)));
      assert.deepEqual(await s.getPrefs(a), { prefs: prefsOf("ms", at(3)), watchlist: listOf(4.5, at(3)) });
    },
  },
  {
    name: "settings: an older change is ignored, a newer one wins, and an equal time changes nothing",
    run: async (s, a) => {
      await s.applyPrefs(a, prefsOf("ms", at(5)), undefined);
      await s.applyPrefs(a, prefsOf("en", at(3)), undefined);
      assert.equal((await s.getPrefs(a)).prefs!.value.language, "ms");
      await s.applyPrefs(a, prefsOf("en", at(5)), undefined);
      assert.equal((await s.getPrefs(a)).prefs!.value.language, "ms");
      await s.applyPrefs(a, prefsOf("en", at(7)), undefined);
      assert.equal((await s.getPrefs(a)).prefs!.value.language, "en");
      assert.equal((await s.getPrefs(a)).prefs!.updatedAt, at(7));
    },
  },
  {
    name: "settings: preferences and watchlist are independent of each other",
    run: async (s, a) => {
      await s.applyPrefs(a, prefsOf("ms", at(5)), listOf(4.5, at(5)));
      await s.applyPrefs(a, undefined, listOf(4.7, at(8))); // only the watchlist changes
      const got = await s.getPrefs(a);
      assert.equal(got.prefs!.value.language, "ms");
      assert.equal(got.watchlist!.value.countries[0]!.rate, 4.7);
      await s.applyPrefs(a, prefsOf("en", at(9)), listOf(1, at(2))); // newer prefs, older watchlist
      const after = await s.getPrefs(a);
      assert.equal(after.prefs!.value.language, "en");
      assert.equal(after.watchlist!.value.countries[0]!.rate, 4.7);
    },
  },
  {
    name: "settings: two accounts never see each other's",
    run: async (s, a, b) => {
      await s.applyPrefs(a, prefsOf("ms", at(5)), listOf(4.5, at(5)));
      assert.deepEqual(await s.getPrefs(b), { prefs: null, watchlist: null });
      await s.applyPrefs(b, prefsOf("en", at(6)), undefined);
      assert.equal((await s.getPrefs(a)).prefs!.value.language, "ms");
    },
  },
  {
    name: "versions only ever grow",
    run: async (s, a) => {
      await s.apply(a, [piece("v1")], [], MAX);
      await s.apply(a, [piece("v2")], [], MAX);
      await s.apply(a, [piece("v1", { updatedAt: at(9) })], [], MAX);
      const versions = (await s.changedSince(a, 0)).map((r) => r.version);
      assert.deepEqual([...versions].sort((x, y) => x - y), versions);
      assert.equal(new Set(versions).size, versions.length);
    },
  },
];
