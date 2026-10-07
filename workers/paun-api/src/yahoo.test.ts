import { describe, expect, it } from "vitest";
import { fetchYahooGold, fetchYahooGoldAny, parseYahooChart } from "./yahoo";

const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }], error: null } });
const good = { regularMarketPrice: 4172.3, regularMarketTime: 1791300000, symbol: "GC=F", currency: "USD" };
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("parseYahooChart", () => {
  it("reads the price, the market time (as an ISO moment) and the symbol", () => {
    expect(parseYahooChart(chart(good))).toEqual({ priceUsdOz: 4172.3, marketTime: "2026-10-06T15:20:00.000Z", symbol: "GC=F" });
  });

  it.each([
    ["no result at all", { chart: { result: null } }, "no_result"],
    ["an empty body", {}, "no_result"],
    ["a null body", null, "no_result"],
    ["no price", chart({ ...good, regularMarketPrice: undefined }), "no_price"],
    ["a price that is text", chart({ ...good, regularMarketPrice: "4172" }), "no_price"],
    ["a price below any real gold price", chart({ ...good, regularMarketPrice: 41.7 }), "price_out_of_range"],
    ["a price above any real gold price", chart({ ...good, regularMarketPrice: 417_200 }), "price_out_of_range"],
    ["a non-USD currency", chart({ ...good, currency: "EUR" }), "not_usd"],
    ["no market time", chart({ ...good, regularMarketTime: undefined }), "no_time"],
  ])("rejects %s", (_name, body, error) => expect(parseYahooChart(body)).toEqual({ error }));
});

describe("fetchYahooGold", () => {
  it("returns the price on a good answer, and reports which host answered", async () => {
    const r = await fetchYahooGold("query1.finance.yahoo.com", reply(chart(good)) as typeof fetch);
    expect(r).toMatchObject({ ok: true, priceUsdOz: 4172.3, host: "query1.finance.yahoo.com" });
  });

  it("sends a User-Agent (Yahoo refuses requests without one) and asks for GC=F", async () => {
    let seen: { url: string; ua: string | null } | undefined;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, ua: new Headers(init.headers).get("user-agent") };
      return new Response(JSON.stringify(chart(good)));
    }) as unknown as typeof fetch;
    await fetchYahooGold("query1.finance.yahoo.com", spy);
    expect(seen?.url).toContain("/v8/finance/chart/GC=F");
    expect(seen?.ua).toBeTruthy();
  });

  it("reports an HTTP error with its status (Yahoo blocking us looks like a 429 or 403)", async () => {
    expect(await fetchYahooGold("h", reply({}, 429) as typeof fetch)).toMatchObject({ ok: false, reason: "http_error", status: 429 });
  });

  it("reports a reply that is not JSON", async () => {
    const html = (async () => new Response("<html>blocked</html>")) as unknown as typeof fetch;
    expect(await fetchYahooGold("h", html)).toMatchObject({ ok: false, reason: "not_json" });
  });

  it("reports a network failure and a timeout without throwing", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await fetchYahooGold("h", down)).toMatchObject({ ok: false, reason: "network_error" });
    const slow = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch;
    expect(await fetchYahooGold("h", slow)).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("passes bad data on as a reason", async () => {
    expect(await fetchYahooGold("h", reply(chart({ ...good, regularMarketPrice: 3 })) as typeof fetch)).toMatchObject({
      ok: false,
      reason: "price_out_of_range",
    });
  });
});

describe("fetchYahooGoldAny", () => {
  it("falls back to the second host when the first fails, and stops at the first success", async () => {
    const hosts: string[] = [];
    const flaky = (async (url: string) => {
      hosts.push(new URL(url).host);
      return hosts.length === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(chart(good)));
    }) as unknown as typeof fetch;
    const attempts = await fetchYahooGoldAny(flaky);
    expect(attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(hosts).toEqual(["query1.finance.yahoo.com", "query2.finance.yahoo.com"]);
  });

  it("does not try the second host after a success", async () => {
    let calls = 0;
    const ok = (async () => (calls++, new Response(JSON.stringify(chart(good))))) as unknown as typeof fetch;
    await fetchYahooGoldAny(ok);
    expect(calls).toBe(1);
  });
});
