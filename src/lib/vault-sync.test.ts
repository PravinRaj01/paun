import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultItem } from "./gold";
import {
  applyPull,
  clearSyncState,
  CURSOR_OVERLAP,
  EMPTY_STATE,
  loadSyncState,
  newTombstones,
  planPush,
  runSync,
  saveSyncState,
  stampMissing,
  toSyncItem,
  type SyncState,
} from "./vault-sync";

const T = (day: number, h = 0) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const NOW = new Date(T(9, 5));
const piece = (id: string, over: Partial<VaultItem> = {}): VaultItem => ({ id, name: `piece ${id}`, weight: 10, purity: "916", paidUsd: 500, date: "2026-10-01", updatedAt: T(1), ...over });
const state = (over: Partial<SyncState> = {}): SyncState => ({ ...EMPTY_STATE, userId: "u1", ...over });

describe("toSyncItem: only what the server will accept is sent", () => {
  it("keeps a valid piece and its change time", () => expect(toSyncItem(piece("a"), T(9))).toMatchObject({ id: "a", weight: 10, purity: "916", updatedAt: T(1) }));
  it("gives a piece with no change time the fallback", () => expect(toSyncItem(piece("a", { updatedAt: undefined as never }), T(9))!.updatedAt).toBe(T(9)));
  it("shortens a long name instead of refusing the piece", () => expect(toSyncItem(piece("a", { name: "x".repeat(200) }), T(9))!.name).toHaveLength(80));
  it.each([
    ["an id with odd characters", { id: "../x" }],
    ["no weight", { weight: 0 }],
    ["a weight in the millions", { weight: 1e7 }],
    ["an unknown purity", { purity: "925" as never }],
    ["a negative price", { paidUsd: -1 }],
    ["a date that does not exist", { date: "2026-02-31" }],
  ])("skips a piece with %s", (_n, over) => expect(toSyncItem(piece("a", over), T(9))).toBeNull());
});

describe("stampMissing", () => {
  it("stamps only the pieces without a change time, and returns the same list when nothing is missing", () => {
    const v = [piece("a"), piece("b", { updatedAt: undefined as never })];
    const out = stampMissing(v, NOW);
    expect(out[0]).toBe(v[0]);
    expect(out[1]!.updatedAt).toBe(NOW.toISOString());
    const complete = [piece("a")];
    expect(stampMissing(complete, NOW)).toBe(complete);
  });
});

describe("planPush", () => {
  it("a device that has never synced sends everything (the first sign-in union)", () => {
    const p = planPush([piece("a"), piece("b")], EMPTY_STATE, "u1", NOW);
    expect(p.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("afterwards it sends only pieces changed after the last push", () => {
    const s = state({ lastPushedAt: T(5) });
    const p = planPush([piece("old", { updatedAt: T(2) }), piece("new", { updatedAt: T(7) })], s, "u1", NOW);
    expect(p.items.map((i) => i.id)).toEqual(["new"]);
  });

  it("a different account on the same device starts afresh: everything is sent again", () => {
    const s = state({ userId: "someone-else", lastPushedAt: T(8), version: 500 });
    expect(planPush([piece("a", { updatedAt: T(2) })], s, "u1", NOW).items.map((i) => i.id)).toEqual(["a"]);
  });

  it("carries pending removals, but not for a piece that is back in the Vault", () => {
    const s = state({ tombstones: [{ id: "gone", deletedAt: T(8) }, { id: "back", deletedAt: T(8) }] });
    const p = planPush([piece("back", { updatedAt: T(1) })], s, "u1", NOW);
    expect(p.removed).toEqual([{ id: "gone", deletedAt: T(8) }]);
  });

  it("counts a corrupt piece as skipped instead of letting it block the rest", () => {
    const p = planPush([piece("ok"), piece("bad", { weight: -5 })], EMPTY_STATE, "u1", NOW);
    expect(p.items.map((i) => i.id)).toEqual(["ok"]);
    expect(p.skipped).toBe(1);
  });
});

describe("applyPull", () => {
  const srv = (id: string, over: object = {}) => ({ id, name: `server ${id}`, weight: 5, purity: "999.9", paidUsd: 100, date: "2026-10-02", updatedAt: T(4), ...over });

  it("adds pieces from the account that the device lacks, and keeps the device's own pieces", () => {
    const m = applyPull([piece("mine")], { items: [srv("theirs")], removed: [] });
    expect(m.vault.map((v) => v.id)).toEqual(["mine", "theirs"]);
    expect(m.added).toBe(1);
    expect(m.vault[1]).toMatchObject({ name: "server theirs", purity: "999.9" });
  });

  it("the same piece on both sides is not duplicated, and the newer copy wins", () => {
    const older = applyPull([piece("x", { name: "local", updatedAt: T(6) })], { items: [srv("x", { updatedAt: T(4) })], removed: [] });
    expect(older.vault).toHaveLength(1);
    expect(older.vault[0]!.name).toBe("local");
    const newer = applyPull([piece("x", { name: "local", updatedAt: T(3) })], { items: [srv("x", { updatedAt: T(4) })], removed: [] });
    expect(newer.vault[0]!.name).toBe("server x");
    expect(newer.updated).toBe(1);
  });

  it("a removal from the account removes the local copy, unless the local copy is newer than the removal", () => {
    expect(applyPull([piece("x", { updatedAt: T(1) })], { items: [], removed: [{ id: "x", deletedAt: T(5) }] }).vault).toEqual([]);
    expect(applyPull([piece("x", { updatedAt: T(8) })], { items: [], removed: [{ id: "x", deletedAt: T(5) }] }).vault).toHaveLength(1);
  });

  it("reports which pieces were removed because the server said so (so they are not mistaken for the person's own removals)", () => {
    expect(applyPull([piece("x"), piece("y")], { items: [], removed: [{ id: "x", deletedAt: T(5) }] }).removed).toEqual(["x"]);
  });

  it("leaves out a piece with a purity this app version does not know, rather than guessing", () => {
    const m = applyPull([], { items: [srv("odd", { purity: "925" })], removed: [] });
    expect(m.vault).toEqual([]);
  });

  it("keeps the device's order and appends new arrivals at the end", () => {
    const m = applyPull([piece("b"), piece("a")], { items: [srv("c"), srv("a", { updatedAt: T(9) })], removed: [] });
    expect(m.vault.map((v) => v.id)).toEqual(["b", "a", "c"]);
  });
});

describe("newTombstones: noticing the person's own removals", () => {
  it("a piece that vanished from the Vault becomes a removal stamped now", () => {
    expect(newTombstones(new Set(["a", "b"]), [piece("a")], new Set(), NOW)).toEqual([{ id: "b", deletedAt: NOW.toISOString() }]);
  });
  it("ignores pieces the server removed, and nothing vanished means nothing to report", () => {
    expect(newTombstones(new Set(["a", "b"]), [piece("a")], new Set(["b"]), NOW)).toEqual([]);
    expect(newTombstones(new Set(["a"]), [piece("a")], new Set(), NOW)).toEqual([]);
  });
});

describe("the saved sync state", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips, and clearing it starts over", () => {
    const s = state({ version: 12, lastSyncAt: T(8), lastPushedAt: T(8), tombstones: [{ id: "z", deletedAt: T(8) }] });
    saveSyncState(s);
    expect(loadSyncState()).toEqual(s);
    clearSyncState();
    expect(loadSyncState()).toEqual(EMPTY_STATE);
  });

  it.each(["{oops", "null", '"text"', '{"version":-5,"tombstones":"nope","userId":42}'])("damaged data (%s) falls back to an empty state", (raw) => {
    store.set("gold-assistant:sync", raw);
    expect(loadSyncState()).toEqual(EMPTY_STATE);
  });

  it("never throws when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } });
    expect(() => saveSyncState(EMPTY_STATE)).not.toThrow();
    expect(loadSyncState()).toEqual(EMPTY_STATE);
  });
});

describe("runSync (one round trip)", () => {
  const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const ok = { ok: true, version: 40, items: [], removed: [] };

  it("sends the pieces, removals and a cursor rewound by the overlap, with the bearer token", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify(ok)))) as unknown as typeof fetch;
    const s = state({ version: 1000, tombstones: [{ id: "gone", deletedAt: T(8) }] });
    const r = await runSync({ token: "tok.sig", userId: "u1", vault: [piece("a")], state: s, now: NOW, fetchImpl: spy, base: "https://api.test" });
    expect(r.ok).toBe(true);
    expect(seen!.url).toBe("https://api.test/sync");
    expect(new Headers(seen!.init.headers).get("authorization")).toBe("Bearer tok.sig");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.since).toBe(1000 - CURSOR_OVERLAP);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["a"]);
    expect(body.removed).toEqual([{ id: "gone", deletedAt: T(8) }]);
    expect(JSON.stringify(body)).not.toContain("tok.sig");
  });

  it("on success: moves the cursor forward, drops the removals the server now has, and keeps newer ones", async () => {
    const s = state({ version: 30, tombstones: [{ id: "sent", deletedAt: T(8) }] });
    const r = await runSync({ token: "t", userId: "u1", vault: [], state: s, now: NOW, fetchImpl: reply({ ...ok, version: 55 }) });
    expect(r).toMatchObject({ ok: true, state: { userId: "u1", version: 55, lastSyncAt: NOW.toISOString(), lastPushedAt: NOW.toISOString(), tombstones: [] } });
  });

  it("the cursor never moves backwards", async () => {
    const r = await runSync({ token: "t", userId: "u1", vault: [], state: state({ version: 90 }), now: NOW, fetchImpl: reply({ ...ok, version: 40 }) });
    expect(r.ok && r.state.version).toBe(90);
  });

  it("hands back a merge to apply to the Vault as it is at that moment", async () => {
    const pulled = { ...ok, items: [{ id: "n", name: "new", weight: 3, purity: "916", paidUsd: 1, date: "2026-10-01", updatedAt: T(5) }] };
    const r = await runSync({ token: "t", userId: "u1", vault: [], state: state(), now: NOW, fetchImpl: reply(pulled) });
    if (!r.ok) throw new Error("expected ok");
    expect(r.merge([piece("typed-while-syncing")]).vault.map((v) => v.id)).toEqual(["typed-while-syncing", "n"]);
  });

  it.each([
    [401, "signed_out"], [429, "rate_limited"], [413, "too_many"], [400, "invalid"], [500, "unavailable"], [503, "unavailable"],
  ])("HTTP %i is reported as %s and changes nothing", async (status, error) => {
    expect(await runSync({ token: "t", userId: "u1", vault: [], state: state(), fetchImpl: reply({}, status) })).toEqual({ ok: false, error });
  });

  it("no connection is 'offline', and a garbled answer is 'unavailable'", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await runSync({ token: "t", userId: "u1", vault: [], state: state(), fetchImpl: down })).toEqual({ ok: false, error: "offline" });
    expect(await runSync({ token: "t", userId: "u1", vault: [], state: state(), fetchImpl: reply({ ok: true }) })).toEqual({ ok: false, error: "unavailable" });
  });

  it("a different account's saved state is discarded (its cursor and removals are not carried over)", async () => {
    let body: { since: number; removed: unknown[] } | undefined;
    const spy = (async (_u: string, init: RequestInit) => ((body = JSON.parse(String(init.body))), new Response(JSON.stringify(ok)))) as unknown as typeof fetch;
    await runSync({ token: "t", userId: "u2", vault: [], state: state({ userId: "u1", version: 999, tombstones: [{ id: "x", deletedAt: T(8) }] }), now: NOW, fetchImpl: spy });
    expect(body).toMatchObject({ since: 0, removed: [] });
  });
});
