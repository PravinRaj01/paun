import { describe, expect, it } from "vitest";
import { fitWithin, requestScan, scanErrorKey, scanResponseSchema, type ScanItemRead } from "./scan";
import en from "../locales/en.json";
import ms from "../locales/ms.json";

const item = (over: Partial<ScanItemRead> = {}): ScanItemRead => ({
  itemName: "Rantai tangan 916",
  purity: "916",
  weightGrams: 12.5,
  makingFee: { amount: 8, per: "gram" },
  lineTotal: 6120.5,
  ...over,
});
const receipt = { purchaseDate: "2026-09-30", totalPaid: 6120.5, currency: "MYR" };
const good = { ok: true, readable: true, confidence: "high", receipt, items: [item()] };

describe("fitWithin (shrinking a photo before upload)", () => {
  it("scales the longest side down to 1280 and keeps the proportions", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 960, height: 1280 });
  });
  it("never enlarges a small photo", () => expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 }));
  it("leaves a photo exactly at the limit alone, and never produces a 0-pixel side", () => {
    expect(fitWithin(1280, 800)).toEqual({ width: 1280, height: 800 });
    expect(fitWithin(100_000, 10)).toEqual({ width: 1280, height: 1 });
  });
});

describe("the Worker's answer is validated before it reaches the review", () => {
  it("accepts a well-formed answer with several pieces", () => {
    const r = scanResponseSchema.safeParse({ ...good, items: [item(), item({ weightGrams: 40, lineTotal: 4212 }), item({ weightGrams: 50 })] });
    expect(r.success && r.data.items.map((i) => i.weightGrams)).toEqual([12.5, 40, 50]);
  });

  it("still understands the older one-piece answer (the page can be deployed before the Worker)", () => {
    const legacy = {
      ok: true,
      readable: true,
      confidence: "medium",
      fields: { itemName: "Gold Bar", purity: "999.9", weightGrams: 200, makingFee: null, purchaseDate: "2008-12-18", totalPaid: 30507, currency: "MYR" },
    };
    const r = scanResponseSchema.safeParse(legacy);
    expect(r.success && r.data).toMatchObject({
      receipt: { purchaseDate: "2008-12-18", totalPaid: 30507, currency: "MYR" },
      items: [{ itemName: "Gold Bar", purity: "999.9", weightGrams: 200, lineTotal: null }],
    });
  });

  it("an older answer with nothing readable in it becomes no pieces, not a blank piece", () => {
    const legacy = { ok: true, readable: true, confidence: "low", fields: { itemName: null, purity: null, weightGrams: null, makingFee: null, ...receipt } };
    const r = scanResponseSchema.safeParse(legacy);
    expect(r.success && r.data.items).toEqual([]);
  });

  it.each([
    ["a purity the app does not know", { ...good, items: [item({ purity: "925" as never })] }],
    ["a negative weight", { ...good, items: [item({ weightGrams: -1 })] }],
    ["a malformed date", { ...good, receipt: { ...receipt, purchaseDate: "30/09/2026" } }],
    ["a currency that is not a 3-letter code", { ...good, receipt: { ...receipt, currency: "ringgit" } }],
    ["more than 20 pieces", { ...good, items: Array.from({ length: 21 }, () => item()) }],
    ["neither items nor fields", { ok: true, readable: true, confidence: "high" }],
    ["an error body", { ok: false, error: "scanner_busy" }],
  ])("rejects %s", (_n, body) => expect(scanResponseSchema.safeParse(body).success).toBe(false));
});

describe("requestScan", () => {
  const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("posts the photo, its type and the Turnstile token as JSON", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify(good)))) as unknown as typeof fetch;
    const res = await requestScan("QUJD", "image/jpeg", "tok-1", spy, "https://x/scan");
    expect(res).toMatchObject({ ok: true, readable: true });
    expect(seen?.url).toBe("https://x/scan");
    expect(seen?.init.method).toBe("POST");
    expect(JSON.parse(String(seen?.init.body))).toEqual({ image: "QUJD", mimeType: "image/jpeg", turnstileToken: "tok-1" });
  });

  it("sends the visitor's own Gemini key in a header only when there is one, never in the body or the URL", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(JSON.stringify(good)))) as unknown as typeof fetch;
    await requestScan("QUJD", "image/jpeg", "tok", spy, "https://x/scan");
    await requestScan("QUJD", "image/jpeg", "tok", spy, "https://x/scan", "AIzaSyOwnKeyForTesting_1234567890abcd");
    await requestScan("QUJD", "image/jpeg", "tok", spy, "https://x/scan", null);
    const h = (i: number) => new Headers(seen[i]!.init.headers).get("x-gemini-key");
    expect([h(0), h(1), h(2)]).toEqual([null, "AIzaSyOwnKeyForTesting_1234567890abcd", null]);
    expect(String(seen[1]!.init.body)).not.toContain("AIzaSy");
    expect(seen[1]!.url).not.toContain("AIzaSy");
  });

  it("passes the Worker's error code through", async () => {
    expect(await requestScan("a", "image/jpeg", "t", reply({ ok: false, error: "scanner_busy" }, 503), "https://x")).toEqual({ ok: false, error: "scanner_busy" });
  });

  it("reports a network failure and a garbled answer as their own codes", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await requestScan("a", "image/jpeg", "t", down, "https://x")).toEqual({ ok: false, error: "network" });
    expect(await requestScan("a", "image/jpeg", "t", reply({ ok: true, items: {} }), "https://x")).toEqual({ ok: false, error: "bad_answer" });
  });
});

describe("error messages", () => {
  it("every error the Worker can send has a message, and unknown ones fall back to 'unavailable'", () => {
    for (const code of ["scanner_busy", "rate_limited", "turnstile_failed", "verification_unavailable", "too_large", "image_rejected", "network", "decode", "user_key_rejected", "user_key_quota"]) {
      expect(scanErrorKey(code)).not.toBe("scanErrUnavailable");
    }
    for (const code of ["scanner_not_configured", "forbidden_origin", "invalid_request", "scanner_unavailable", "something_new"]) {
      expect(scanErrorKey(code)).toBe("scanErrUnavailable");
    }
  });

  it("English and Malay have the same scanner copy keys, with the same {{placeholders}}", () => {
    const keys = (o: Record<string, string>) => Object.keys(o).filter((k) => k.startsWith("scan")).sort();
    expect(keys(ms)).toEqual(keys(en));
    const holes = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();
    for (const k of keys(en)) expect(holes((ms as Record<string, string>)[k]!)).toBe(holes((en as Record<string, string>)[k]!));
  });
});
