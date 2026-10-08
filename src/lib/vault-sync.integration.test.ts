import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAuth } from "../../workers/paun-api/src/auth-test-kit";
import { corsHeaders } from "../../workers/paun-api/src/cors";
import { handleSync } from "../../workers/paun-api/src/vault/handler";
import { MemoryVaultStore, type VaultStoreFactory } from "../../workers/paun-api/src/vault/store";
import type { VaultItem } from "./gold";
import { EMPTY_STATE, newTombstones, runSync, stampMissing, type SyncState } from "./vault-sync";

/**
 * Two (or more) simulated devices syncing through the REAL Worker code (real sign-in library, real merge rules, in-memory store).
 * Each device keeps what a browser would: a Vault, a saved sync state, and the list of ids it last saw (to notice removals).
 */
const ORIGIN = "https://paun-web.paun-gold.workers.dev";
let clock = new Date("2026-10-09T05:00:00Z");
const tick = (minutes: number) => void (clock = new Date(clock.getTime() + minutes * 60_000));

beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

async function world() {
  const auth = await memoryAuth();
  const store = new MemoryVaultStore();
  const storeFactory: VaultStoreFactory = () => ({ store, close: async () => undefined });
  const fetchFor = (token: string): typeof fetch =>
    (async (url: string, init: RequestInit) => {
      const headers = { ...(init.headers as Record<string, string>), origin: ORIGIN };
      return handleSync(new Request(url, { ...init, headers }), auth.env, corsHeaders(ORIGIN, auth.env), undefined, auth.factory, storeFactory, clock);
    }) as unknown as typeof fetch;

  const device = (name: string, session: { user: { id: string }; bearerToken: string }, initial: VaultItem[] = []) => {
    const d = {
      name,
      vault: initial,
      state: { ...EMPTY_STATE } as SyncState,
      knownIds: new Set(initial.map((v) => v.id)),
      serverRemoved: new Set<string>(),
      /** The person adds a piece (as the Vault page does: no change time, the sync stamps it). */
      add(id: string, extra: Partial<VaultItem> = {}) {
        d.vault = [...d.vault, { id, name: `${name}:${id}`, weight: 10, purity: "916", paidUsd: 500, date: "2026-10-01", ...extra }];
      },
      /** The person removes a piece. */
      remove(id: string) {
        d.vault = d.vault.filter((v) => v.id !== id);
      },
      /** What the sync hook does around every sync: stamp, notice removals, send, merge. */
      async sync() {
        d.vault = stampMissing(d.vault, clock);
        const gone = newTombstones(d.knownIds, d.vault, d.serverRemoved, clock);
        d.state = { ...d.state, tombstones: [...d.state.tombstones, ...gone] };
        const r = await runSync({ token: session.bearerToken, userId: session.user.id, vault: d.vault, state: d.state, now: clock, fetchImpl: fetchFor(session.bearerToken), base: "https://api.test" });
        if (!r.ok) throw new Error(`sync failed: ${r.error}`);
        const merged = r.merge(d.vault);
        d.vault = merged.vault;
        d.serverRemoved = new Set(merged.removed);
        d.state = r.state;
        d.knownIds = new Set(d.vault.map((v) => v.id));
        return merged;
      },
      ids: () => d.vault.map((v) => v.id).sort(),
    };
    return d;
  };
  return { ...auth, device, store };
}

describe("two devices, one account", () => {
  it("a piece added on the phone appears on the laptop", async () => {
    const w = await world();
    const phone = w.device("phone", w);
    const laptop = w.device("laptop", w);
    phone.add("ring");
    await phone.sync();
    tick(1);
    const got = await laptop.sync();
    expect(got.added).toBe(1);
    expect(laptop.ids()).toEqual(["ring"]);
    expect(laptop.vault[0]).toMatchObject({ name: "phone:ring", weight: 10, purity: "916", paidUsd: 500 });
  });

  it("first sign-in is a union: pieces already on each device AND in the account are all kept, none duplicated", async () => {
    const w = await world();
    const phone = w.device("phone", w, [{ id: "p1", name: "p1", weight: 5, purity: "916", paidUsd: 1, date: "2026-10-01" }, { id: "shared", name: "shared", weight: 5, purity: "916", paidUsd: 1, date: "2026-10-01" }]);
    const laptop = w.device("laptop", w, [{ id: "l1", name: "l1", weight: 5, purity: "916", paidUsd: 1, date: "2026-10-01" }, { id: "shared", name: "shared", weight: 5, purity: "916", paidUsd: 1, date: "2026-10-01" }]);
    await phone.sync();
    tick(1);
    await laptop.sync();
    tick(1);
    await phone.sync();
    expect(phone.ids()).toEqual(["l1", "p1", "shared"]);
    expect(laptop.ids()).toEqual(["l1", "p1", "shared"]);
  });

  it("a removal on one device reaches the other", async () => {
    const w = await world();
    const phone = w.device("phone", w);
    const laptop = w.device("laptop", w);
    phone.add("a");
    phone.add("b");
    await phone.sync();
    tick(1);
    await laptop.sync();
    tick(1);
    laptop.remove("a");
    await laptop.sync();
    tick(1);
    const got = await phone.sync();
    expect(got.removed).toEqual(["a"]);
    expect(phone.ids()).toEqual(["b"]);
  });

  it("a device that was offline cannot bring a removed piece back", async () => {
    const w = await world();
    const phone = w.device("phone", w);
    const laptop = w.device("laptop", w);
    phone.add("keepsake");
    await phone.sync();
    tick(1);
    await laptop.sync();
    tick(60);
    laptop.remove("keepsake");
    await laptop.sync();
    tick(60 * 24 * 3); // the phone has been off for three days and still holds its old copy
    await phone.sync();
    expect(phone.ids()).toEqual([]);
    tick(1);
    await laptop.sync();
    expect(laptop.ids()).toEqual([]);
  });

  it("both devices adding pieces at the same time end up with everything", async () => {
    const w = await world();
    const phone = w.device("phone", w);
    const laptop = w.device("laptop", w);
    phone.add("from-phone");
    laptop.add("from-laptop");
    await phone.sync();
    tick(1);
    await laptop.sync();
    tick(1);
    await phone.sync();
    expect(phone.ids()).toEqual(["from-laptop", "from-phone"]);
    expect(laptop.ids()).toEqual(["from-laptop", "from-phone"]);
  });

  it("syncing again with nothing new sends nothing and changes nothing", async () => {
    const w = await world();
    const phone = w.device("phone", w);
    phone.add("a");
    await phone.sync();
    tick(1);
    const before = phone.vault;
    const again = await phone.sync();
    expect([again.added, again.updated, again.removed]).toEqual([0, 0, []]);
    expect(phone.vault).toEqual(before);
  });

  it("a piece removed and then added back under a new id is a new piece, not a resurrection", async () => {
    const w = await world();
    const phone = w.device("phone", w);
    const laptop = w.device("laptop", w);
    phone.add("old");
    await phone.sync();
    tick(1);
    phone.remove("old");
    phone.add("new");
    await phone.sync();
    tick(1);
    await laptop.sync();
    expect(laptop.ids()).toEqual(["new"]);
  });
});

describe("two accounts", () => {
  it("never see each other's pieces, even from the same kind of device", async () => {
    const w = await world();
    const other = await w.newSession("other@example.com", "Other");
    const mine = w.device("mine", w);
    const theirs = w.device("theirs", other);
    mine.add("my-ring");
    theirs.add("their-ring");
    await mine.sync();
    await theirs.sync();
    tick(1);
    await mine.sync();
    await theirs.sync();
    expect(mine.ids()).toEqual(["my-ring"]);
    expect(theirs.ids()).toEqual(["their-ring"]);
  });
});
