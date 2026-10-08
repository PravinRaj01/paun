import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountEnv, memoryAuth } from "../auth-test-kit";
import { corsHeaders } from "../cors";
import { handle } from "../index";
import { testEnv } from "../test-kit";
import { handleSync, type SyncResponse } from "./handler";
import { piece } from "./scenarios";
import { scenarios } from "./scenarios";
import { MemoryVaultStore, type VaultStoreFactory } from "./store";
import { MAX_ITEMS, SYNC_PER_HOUR, validateSyncBody } from "./validate";

const ORIGIN = "https://paun-web.paun-gold.workers.dev";
const NOW = new Date("2026-10-09T05:00:00Z");

describe("the store rules (the same scenarios also run against the real Neon database)", () => {
  it.each(scenarios.map((s) => [s.name, s] as const))("%s", async (_name, scenario) => {
    await scenario.run(new MemoryVaultStore(), "user-a", "user-b");
  });
});

describe("validateSyncBody: nothing reaches the database unchecked", () => {
  const ok = (over: object = {}) => ({ since: 0, items: [piece("a1")], removed: [{ id: "r1", deletedAt: "2026-10-05T00:00:00.000Z" }], ...over });

  it("accepts a well-formed request and defaults missing lists to empty", () => {
    expect(validateSyncBody(ok(), NOW)).toMatchObject({ ok: true });
    expect(validateSyncBody({}, NOW)).toEqual({ ok: true, value: { since: 0, items: [], removed: [] } });
  });

  it.each([
    ["a body that is not an object", "text", "body"],
    ["a negative since", ok({ since: -1 }), "since"],
    ["a since that is not a whole number", ok({ since: 1.5 }), "since"],
    ["items that are not a list", ok({ items: {} }), "items"],
    ["a piece with no id", ok({ items: [{ ...piece("x"), id: undefined }] }), "items"],
    ["a piece id with odd characters", ok({ items: [piece("../etc")] }), "items"],
    ["a name that is too long", ok({ items: [piece("n1", { name: "x".repeat(81) })] }), "items"],
    ["a zero weight", ok({ items: [piece("w1", { weight: 0 })] }), "items"],
    ["a huge weight", ok({ items: [piece("w2", { weight: 20_000 })] }), "items"],
    ["a purity the app does not know", ok({ items: [piece("p1", { purity: "925" as never })] }), "items"],
    ["a negative price", ok({ items: [piece("m1", { paidUsd: -1 })] }), "items"],
    ["a date that does not exist", ok({ items: [piece("d1", { date: "2026-02-31" })] }), "items"],
    ["an updatedAt with no timezone", ok({ items: [piece("t1", { updatedAt: "2026-10-01T00:00:00" })] }), "items"],
    ["an updatedAt far in the future", ok({ items: [piece("t2", { updatedAt: "2030-01-01T00:00:00.000Z" })] }), "items"],
    ["an updatedAt before 2020", ok({ items: [piece("t3", { updatedAt: "2001-01-01T00:00:00.000Z" })] }), "items"],
    ["a removal with a bad time", ok({ removed: [{ id: "r1", deletedAt: "yesterday" }] }), "removed"],
    ["the same piece added and removed in one request", ok({ items: [piece("dup")], removed: [{ id: "dup", deletedAt: "2026-10-05T00:00:00.000Z" }] }), "items"],
    ["the same piece twice", ok({ items: [piece("dup"), piece("dup")] }), "items"],
    ["too many pieces", ok({ items: Array.from({ length: MAX_ITEMS + 1 }, (_v, i) => piece(`p${i}`)) }), "items"],
  ])("rejects %s", (_n, body, field) => expect(validateSyncBody(body, NOW)).toEqual({ ok: false, field }));
});

// ---------- the HTTP route, with the real sign-in library and the in-memory store ----------
const req = (body: unknown, token: string | null, init: { origin?: string; raw?: string } = {}) =>
  new Request("https://paun-api.paun-gold.workers.dev/sync", {
    method: "POST",
    headers: { origin: init.origin ?? ORIGIN, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.raw ?? JSON.stringify(body),
  });

async function setup() {
  const auth = await memoryAuth();
  const memory = new MemoryVaultStore();
  const closedStores: number[] = [];
  const storeFactory: VaultStoreFactory = () => ({ store: memory, close: async () => void closedStores.push(1) });
  const env = auth.env;
  const call = async (body: unknown, token: string | null, init: { origin?: string; raw?: string } = {}) => {
    const res = await handleSync(req(body, token, init), env, corsHeaders(init.origin ?? ORIGIN, env), undefined, auth.factory, storeFactory, NOW);
    return { res, json: (await res.json()) as SyncResponse & { error?: string; field?: string } };
  };
  return { ...auth, memory, call, closedStores };
}

describe("POST /sync: guards", () => {
  beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("another website's origin is refused, with no token it is 401, and unset accounts answer 503", async () => {
    const t = await setup();
    expect((await t.call({}, t.bearerToken, { origin: "https://evil.example" })).res.status).toBe(403);
    expect((await t.call({}, null)).res.status).toBe(401);
    expect((await t.call({}, "made-up.token")).res.status).toBe(401);
    const off = await handleSync(req({}, "x"), testEnv(), {}, undefined, t.factory, () => ({ store: t.memory, close: async () => undefined }), NOW);
    expect(off.status).toBe(503);
  });

  it("only POST is routed (GET is 405) and the Worker wires /sync in", async () => {
    const t = await setup();
    const get = await handle(new Request("https://paun-api.paun-gold.workers.dev/sync", { method: "GET", headers: { origin: ORIGIN } }), t.env, NOW);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");
    const post = await handle(req({}, null), accountEnv(), NOW);
    expect(post.status).toBe(401); // reached the route; no token
  });

  it.each([
    ["invalid JSON", undefined, "{not json", "body"],
    ["a bad piece", { items: [piece("w", { weight: -1 })] }, undefined, "items"],
  ])("answers 400 with the field for %s, and stores nothing", async (_n, body, raw, field) => {
    const t = await setup();
    const { res, json } = await t.call(body ?? {}, t.bearerToken, raw ? { raw } : {});
    expect([res.status, json.error, json.field]).toEqual([400, "invalid_request", field]);
    expect(await t.memory.changedSince(t.user.id, 0)).toEqual([]);
  });

  it("refuses a request over the size limit", async () => {
    const t = await setup();
    const { res } = await t.call({ pad: "x".repeat(600_000) }, t.bearerToken);
    expect(res.status).toBe(413);
  });

  it(`allows ${SYNC_PER_HOUR} syncs an hour per account, then 429, and another account is unaffected`, async () => {
    const t = await setup();
    const other = await t.newSession("other@example.com", "Other");
    for (let i = 0; i < SYNC_PER_HOUR; i++) expect((await t.call({}, t.bearerToken)).res.status).toBe(200);
    expect((await t.call({}, t.bearerToken)).res.status).toBe(429);
    expect((await t.call({}, other.bearerToken)).res.status).toBe(200);
  });

  it("over 2,000 live pieces is refused as a whole (413 too_many_items) and nothing is stored", async () => {
    const t = await setup();
    const many = Array.from({ length: MAX_ITEMS }, (_v, i) => piece(`m${i}`));
    expect((await t.call({ items: many }, t.bearerToken)).res.status).toBe(200);
    const over = await t.call({ items: [piece("one-too-many")] }, t.bearerToken);
    expect([over.res.status, over.json.error]).toEqual([413, "too_many_items"]);
    expect((await t.memory.changedSince(t.user.id, 0)).some((r) => r.id === "one-too-many")).toBe(false);
  });
});

describe("POST /sync: two devices of one account", () => {
  beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("a piece pushed from device A shows up on device B, and a removal on B reaches A", async () => {
    const t = await setup();
    // device A (first sign-in: it has two pieces) pushes and learns the version
    const a1 = await t.call({ since: 0, items: [piece("a-1", { name: "Chain" }), piece("a-2")] }, t.bearerToken);
    expect(a1.json.items.map((i) => i.id).sort()).toEqual(["a-1", "a-2"]); // it hears its own pieces back: harmless
    const versionA = a1.json.version;
    expect(versionA).toBeGreaterThan(0);

    // device B has never synced and has one piece of its own: the union comes back
    const b1 = await t.call({ since: 0, items: [piece("b-1")] }, t.bearerToken);
    expect(b1.json.items.map((i) => i.id).sort()).toEqual(["a-1", "a-2", "b-1"]);
    expect(b1.json.items.find((i) => i.id === "a-1")).toMatchObject({ name: "Chain", weight: 10, purity: "916" });

    // B removes a-2; A syncs from its old version and learns it
    await t.call({ since: b1.json.version, removed: [{ id: "a-2", deletedAt: "2026-10-09T01:00:00.000Z" }] }, t.bearerToken);
    const a2 = await t.call({ since: versionA }, t.bearerToken);
    expect(a2.json.removed.map((r) => r.id)).toEqual(["a-2"]);
    expect(a2.json.items.map((i) => i.id)).toEqual(["b-1"]);
  });

  it("an offline device cannot bring a removed piece back", async () => {
    const t = await setup();
    await t.call({ items: [piece("p", { updatedAt: "2026-10-01T00:00:00.000Z" })] }, t.bearerToken);
    await t.call({ removed: [{ id: "p", deletedAt: "2026-10-05T00:00:00.000Z" }] }, t.bearerToken);
    const late = await t.call({ since: 0, items: [piece("p", { updatedAt: "2026-10-01T00:00:00.000Z" })] }, t.bearerToken);
    expect(late.json.items.map((i) => i.id)).not.toContain("p");
    expect(late.json.removed.map((r) => r.id)).toContain("p");
  });

  it("the version only moves forward, and asking again from it returns nothing", async () => {
    const t = await setup();
    const first = await t.call({ items: [piece("v1")] }, t.bearerToken);
    const again = await t.call({ since: first.json.version }, t.bearerToken);
    expect(again.json.items).toEqual([]);
    expect(again.json.removed).toEqual([]);
    expect(again.json.version).toBe(first.json.version);
  });

  it("each account sees only its own pieces; the account id in a request body is ignored", async () => {
    const t = await setup();
    const other = await t.newSession("other@example.com", "Other");
    await t.call({ items: [piece("mine")] }, t.bearerToken);
    await t.call({ items: [piece("theirs")] }, other.bearerToken);
    const mine = await t.call({ since: 0, userId: other.user.id }, t.bearerToken); // asking for someone else's data by id
    expect(mine.json.items.map((i) => i.id)).toEqual(["mine"]);
    const theirs = await t.call({ since: 0 }, other.bearerToken);
    expect(theirs.json.items.map((i) => i.id)).toEqual(["theirs"]);
  });

  it("closes the database connection after the request, and the log holds counts only", async () => {
    const spy = vi.mocked(console.log);
    const t = await setup();
    await t.call({ items: [piece("secret-id-123", { name: "Grandmother's bangle" })] }, t.bearerToken);
    expect(t.closedStores).toHaveLength(1);
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain("sync:");
    for (const secret of ["secret-id-123", "Grandmother", t.user.id, "member@example.com"]) expect(logged).not.toContain(secret);
  });

  it("a storage failure is a 502 sync_failed with no details, and the connection is still closed", async () => {
    const t = await setup();
    const failing: VaultStoreFactory = () => ({ store: { apply: async () => { throw new Error("db down: password=hunter2"); }, changedSince: async () => [] }, close: async () => void t.closedStores.push(1) });
    const res = await handleSync(req({ items: [piece("x")] }, t.bearerToken), t.env, corsHeaders(ORIGIN, t.env), undefined, t.factory, failing, NOW);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("hunter2");
    expect(t.closedStores).toHaveLength(1);
  });
});
