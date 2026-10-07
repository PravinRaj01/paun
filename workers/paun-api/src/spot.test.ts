import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reserveGoldApiCall } from "./budget";
import { fetchGoldApi } from "./goldapi";
import worker, { handle } from "./index";
import { BACKUP_AFTER_MS, readSpot, refreshSpot } from "./spot";
import { fakeFetch, fakeKv, testEnv, yahooReply } from "./test-kit";

// the job logs one line per run; keep the test output readable (one test below checks what is logged)
beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const T0 = new Date("2026-10-07T16:10:00Z"); // a Wednesday
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const goldapiReply = (price: number, timestamp = 1791389000) => new Response(JSON.stringify({ price, timestamp }));
const down = () => new Response("blocked", { status: 429 });
const stored = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ priceUsdOz: 4100, fetchedAt: T0.toISOString(), marketTime: "2026-10-07T16:03:25.000Z", provider: "yahoo", ...over });

describe("refreshSpot: Yahoo first", () => {
  it("stores the Yahoo price with the time it was fetched and the time it was struck", async () => {
    const env = testEnv();
    const f = fakeFetch({ yahoo: () => yahooReply(4133.5) });
    await refreshSpot(env, T0, f.impl);
    expect(JSON.parse(env.SPOT.data.get("spot:latest")!)).toEqual({
      priceUsdOz: 4133.5,
      fetchedAt: "2026-10-07T16:10:00.000Z",
      marketTime: "2026-10-07T16:03:25.000Z",
      provider: "yahoo",
    });
    expect(f.count("goldapi")).toBe(0);
  });

  it("never touches GoldAPI while Yahoo works, even with a key and a full budget", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k" });
    const f = fakeFetch({ yahoo: () => yahooReply(4133.5), goldapi: () => goldapiReply(1) });
    for (let i = 0; i < 10; i++) await refreshSpot(env, at(i * 15), f.impl);
    expect(f.count("goldapi")).toBe(0);
  });
});

describe("refreshSpot: the budgeted GoldAPI backup", () => {
  it("does not spend a call on a first Yahoo failure when the stored price is still recent", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k" });
    env.SPOT.data.set("spot:latest", stored());
    const f = fakeFetch({ yahoo: down, goldapi: () => goldapiReply(4120) });
    await refreshSpot(env, at(15), f.impl);
    expect(f.count("goldapi")).toBe(0);
    expect(JSON.parse(env.SPOT.data.get("spot:latest")!).provider).toBe("yahoo"); // untouched
  });

  it("uses GoldAPI once the stored price is older than the backup threshold, and records the call", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k" });
    env.SPOT.data.set("spot:latest", stored());
    const f = fakeFetch({ yahoo: down, goldapi: () => goldapiReply(4120.25) });
    await refreshSpot(env, new Date(T0.getTime() + BACKUP_AFTER_MS + 60_000), f.impl);
    expect(f.count("goldapi")).toBe(1);
    expect(f.calls.find((c) => c.host.includes("goldapi"))!.headers.get("x-access-token")).toBe("k");
    const now = JSON.parse(env.SPOT.data.get("spot:latest")!);
    expect(now).toMatchObject({ priceUsdOz: 4120.25, provider: "goldapi" });
    expect(env.SPOT.data.get("goldapi:month:2026-10")).toBe("1");
    expect(env.SPOT.data.get("goldapi:day:2026-10-07")).toBe("1");
  });

  it("uses GoldAPI straight away when nothing has ever been stored", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k" });
    const f = fakeFetch({ yahoo: down, goldapi: () => goldapiReply(4120) });
    await refreshSpot(env, T0, f.impl);
    expect(f.count("goldapi")).toBe(1);
  });

  it("makes no call at all without a key", async () => {
    const env = testEnv();
    const f = fakeFetch({ yahoo: down, goldapi: () => goldapiReply(4120) });
    await refreshSpot(env, T0, f.impl);
    expect(f.count("goldapi")).toBe(0);
    expect(env.SPOT.data.size).toBe(0);
  });

  it("a long Yahoo outage cannot spend more than the daily budget (3), and the old price stays", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k" });
    const f = fakeFetch({ yahoo: down, goldapi: () => goldapiReply(4120) });
    for (let i = 0; i < 24; i++) await refreshSpot(env, at(i * 15), f.impl); // 6 hours of failing Yahoo, still the same UTC day
    expect(f.count("goldapi")).toBe(3);
    expect(env.SPOT.data.get("goldapi:day:2026-10-07")).toBe("3");
  });

  it("stops at the monthly budget, and starts again in a new month", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k", MONTHLY_BUDGET: "2", DAILY_BUDGET: "50" });
    const f = fakeFetch({ yahoo: down, goldapi: () => goldapiReply(4120) });
    for (let i = 0; i < 6; i++) await refreshSpot(env, at(i * 60), f.impl);
    expect(f.count("goldapi")).toBe(2);
    await refreshSpot(env, new Date("2026-11-02T10:00:00Z"), f.impl);
    expect(f.count("goldapi")).toBe(3);
    expect(env.SPOT.data.get("goldapi:month:2026-11")).toBe("1");
  });

  it("a failed GoldAPI call still counts (the budget is reserved before the call) and stores nothing", async () => {
    const env = testEnv({ GOLDAPI_KEY: "k" });
    const f = fakeFetch({ yahoo: down, goldapi: () => new Response("{}", { status: 403 }) });
    await refreshSpot(env, T0, f.impl);
    expect(env.SPOT.data.get("goldapi:month:2026-10")).toBe("1");
    expect(env.SPOT.data.has("spot:latest")).toBe(false);
  });

  it("neither the key nor a response body ever reaches the log", async () => {
    const spy = vi.mocked(console.log);
    const env = testEnv({ GOLDAPI_KEY: "SECRET-KEY-123" });
    const f = fakeFetch({ yahoo: down, goldapi: () => new Response('{"error":"SECRET-BODY"}', { status: 403 }) });
    await refreshSpot(env, T0, f.impl);
    const logged = spy.mock.calls.flat().join("\n");
    spy.mockRestore();
    expect(logged).toContain("spot:");
    expect(logged).not.toContain("SECRET");
  });
});

describe("the budget counters", () => {
  it("reserve until the limits, month and day counted separately in UTC", async () => {
    const env = testEnv({ MONTHLY_BUDGET: "3", DAILY_BUDGET: "2" });
    expect(await reserveGoldApiCall(env, T0)).toMatchObject({ ok: true, usedMonth: 1, usedDay: 1 });
    expect(await reserveGoldApiCall(env, T0)).toMatchObject({ ok: true, usedMonth: 2, usedDay: 2 });
    expect(await reserveGoldApiCall(env, T0)).toEqual({ ok: false, reason: "daily_budget" });
    expect(await reserveGoldApiCall(env, at(24 * 60))).toMatchObject({ ok: true, usedMonth: 3, usedDay: 1 });
    expect(await reserveGoldApiCall(env, at(48 * 60))).toEqual({ ok: false, reason: "monthly_budget" });
  });

  it("falls back to the defaults (90 a month, 3 a day) when the variables are missing or garbage", async () => {
    const env = testEnv({ MONTHLY_BUDGET: "lots", DAILY_BUDGET: "-1" });
    for (let i = 0; i < 3; i++) expect((await reserveGoldApiCall(env, T0)).ok).toBe(true);
    expect((await reserveGoldApiCall(env, T0)).ok).toBe(false);
  });

  it("a budget of 0 turns the backup off", async () => {
    expect((await reserveGoldApiCall(testEnv({ DAILY_BUDGET: "0" }), T0)).ok).toBe(false);
  });
});

describe("fetchGoldApi", () => {
  it("reads the price and the provider's timestamp", async () => {
    const f = fakeFetch({ goldapi: () => goldapiReply(4120.5, 1791389000) });
    expect(await fetchGoldApi("k", f.impl)).toMatchObject({ ok: true, priceUsdOz: 4120.5, marketTime: "2026-10-07T16:03:20.000Z" });
  });

  it.each([
    ["a bad key", () => new Response("{}", { status: 403 }), "http_error"],
    ["the plan limit", () => new Response("{}", { status: 429 }), "http_error"],
    ["no price", () => new Response("{}"), "no_price"],
    ["a price that is nonsense", () => new Response('{"price": 3}'), "price_out_of_range"],
    ["a reply that is not JSON", () => new Response("<html>"), "no_price"],
  ])("fails safely on %s", async (_n, reply, reason) => {
    expect(await fetchGoldApi("k", fakeFetch({ goldapi: reply }).impl)).toMatchObject({ ok: false, reason });
  });

  it("reports a network error without throwing", async () => {
    expect(await fetchGoldApi("k", fakeFetch({ goldapi: () => new TypeError("fetch failed") }).impl)).toMatchObject({ ok: false, reason: "network_error" });
  });
});

describe("GET /spot", () => {
  const spotAt = (now: Date, env = testEnv()) => handle(new Request("https://x/spot"), env, now);

  it("503 with no price yet (nothing stored)", async () => {
    const res = await spotAt(T0);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no_price_yet" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the stored price with its age, a short edge cache and the CORS header", async () => {
    const env = testEnv();
    env.SPOT.data.set("spot:latest", stored());
    const res = await handle(
      new Request("https://x/spot", { headers: { origin: "https://paun-web.paun-gold.workers.dev" } }),
      env,
      at(12),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      priceUsdOz: 4100,
      fetchedAt: "2026-10-07T16:10:00.000Z",
      marketTime: "2026-10-07T16:03:25.000Z",
      provider: "yahoo",
      ageSeconds: 720,
      marketOpen: true,
      stale: false,
    });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://paun-web.paun-gold.workers.dev");
  });

  it("flags a stale price on a weekday (the refresh looks broken) but not on a weekend (market closed)", async () => {
    const env = testEnv();
    env.SPOT.data.set("spot:latest", stored());
    expect(await readSpot(env, at(50))).toMatchObject({ stale: true, marketOpen: false });
    const friday = stored({ fetchedAt: "2026-10-09T23:45:00.000Z", marketTime: "2026-10-09T21:59:00.000Z" });
    env.SPOT.data.set("spot:latest", friday);
    expect(await readSpot(env, new Date("2026-10-10T12:00:00Z"))).toMatchObject({ stale: false, marketOpen: false }); // a Saturday
  });

  it("marketOpen is unknown (null) when the provider gave no time", async () => {
    const env = testEnv();
    env.SPOT.data.set("spot:latest", stored({ marketTime: null, provider: "goldapi" }));
    expect(await readSpot(env, at(5))).toMatchObject({ marketOpen: null, provider: "goldapi" });
  });

  it("ignores a damaged stored value instead of crashing", async () => {
    const env = testEnv();
    env.SPOT.data.set("spot:latest", "{not json");
    expect((await spotAt(T0, env)).status).toBe(503);
    env.SPOT.data.set("spot:latest", JSON.stringify({ priceUsdOz: "4100" }));
    expect((await spotAt(T0, env)).status).toBe(503);
  });

  it("reads KV only: a visitor can never cause a request to a provider", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not be called"));
    const env = testEnv({ GOLDAPI_KEY: "k" });
    env.SPOT.data.set("spot:latest", stored());
    for (let i = 0; i < 5; i++) await spotAt(at(i), env);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the scheduled handler", () => {
  it("refreshes the price inside waitUntil", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => yahooReply(4133.5));
    const env = testEnv();
    const pending: Promise<unknown>[] = [];
    worker.scheduled({ cron: "*/15 * * * 1-5", scheduledTime: T0.getTime() }, env, { waitUntil: (p) => void pending.push(p) });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    spy.mockRestore();
    expect(JSON.parse(env.SPOT.data.get("spot:latest")!)).toMatchObject({ priceUsdOz: 4133.5, provider: "yahoo" });
  });
});

describe("fake kv", () => {
  it("is empty by default", async () => expect(await fakeKv().get("x")).toBeNull());
});
