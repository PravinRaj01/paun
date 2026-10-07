import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./cors";
import { handle } from "./index";

const NOW = new Date("2026-10-07T03:34:00Z");
const call = (path: string, init: RequestInit = {}, env = {}) =>
  handle(new Request(`https://paun-api.paun-gold.workers.dev${path}`, init), env, NOW);

describe("GET /health", () => {
  it("answers ok with the service name and the time of the answer", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "paun-api", time: "2026-10-07T03:34:00.000Z" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /probe (temporary, phase 3b.4)", () => {
  const yahoo = (price: number) =>
    (async () =>
      new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: 1791300000, symbol: "GC=F", currency: "USD" } }] } }))) as unknown as typeof fetch;

  it("reports whether Yahoo answered, and remembers the answer for 30 s so visitors cannot hammer Yahoo", async () => {
    let calls = 0;
    const counting = (async (...a: Parameters<typeof fetch>) => (calls++, yahoo(4172.3)(...a))) as unknown as typeof fetch;
    const t0 = new Date("2026-10-07T10:00:00Z");
    const first = await handle(new Request("https://x/probe"), {}, t0, counting);
    const body = (await first.json()) as { yahooOk: boolean; attempts: { priceUsdOz: number }[] };
    expect(body.yahooOk).toBe(true);
    expect(body.attempts[0]?.priceUsdOz).toBe(4172.3);
    await handle(new Request("https://x/probe"), {}, new Date(t0.getTime() + 10_000), counting);
    expect(calls).toBe(1);
    await handle(new Request("https://x/probe"), {}, new Date(t0.getTime() + 31_000), counting);
    expect(calls).toBe(2);
  });
});

describe("routing", () => {
  it("unknown paths are 404 with a JSON body", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("anything but GET, HEAD and OPTIONS is 405", async () => {
    const res = await call("/health", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });
});

describe("CORS allow-list", () => {
  it.each([
    "https://paun-web.paun-gold.workers.dev",
    "https://feat-price-honesty-paun-web.paun-gold.workers.dev",
    "http://localhost:8080",
    "http://127.0.0.1:8787",
  ])("allows %s", (origin) => expect(isAllowedOrigin(origin, {})).toBe(true));

  it.each([
    null,
    "",
    "https://evil.example",
    "https://paun-web.paun-gold.workers.dev.evil.example",
    "https://evilpaun-web.paun-gold.workers.dev",
    "http://paun-web.paun-gold.workers.dev",
    "https://other-account.workers.dev",
  ])("refuses %s", (origin) => expect(isAllowedOrigin(origin, {})).toBe(false));

  it("allows extra origins from the EXTRA_ORIGINS variable (a custom domain added later)", () => {
    const env = { EXTRA_ORIGINS: "https://paun.example, https://www.paun.example" };
    expect(isAllowedOrigin("https://www.paun.example", env)).toBe(true);
    expect(isAllowedOrigin("https://other.example", env)).toBe(false);
  });

  it("adds the CORS header only for an allowed origin, and always varies on Origin", async () => {
    const ok = await call("/health", { headers: { origin: "https://paun-web.paun-gold.workers.dev" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://paun-web.paun-gold.workers.dev");
    expect(ok.headers.get("vary")).toBe("Origin");
    const bad = await call("/health", { headers: { origin: "https://evil.example" } });
    expect(bad.status).toBe(200);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect(bad.headers.get("vary")).toBe("Origin");
  });

  it("answers the browser's preflight check", async () => {
    const res = await call("/health", { method: "OPTIONS", headers: { origin: "http://localhost:8080" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});
