import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Country, type Settings } from "./gold";
import { fitWithin, requestScan, scanErrorKey, scanResponseSchema, scanToVaultForm, type ScanFieldsRead } from "./scan";
import en from "../locales/en.json";
import ms from "../locales/ms.json";

const countries: Country[] = [
  { id: "my", name: "Malaysia", currency: "MYR", rate: 4.5, duty: 0, tax: 0 },
  { id: "sg", name: "Singapore", currency: "SGD", rate: 1.3, duty: 0, tax: 0 },
];
const myr: Settings = { ...DEFAULT_SETTINGS, baseCurrency: "MYR" };
const usd: Settings = { ...DEFAULT_SETTINGS, baseCurrency: "USD" };
const fields = (over: Partial<ScanFieldsRead> = {}): ScanFieldsRead => ({
  itemName: "Rantai tangan 916",
  purity: "916",
  weightGrams: 12.5,
  makingFee: { amount: 8, per: "gram" },
  purchaseDate: "2026-09-30",
  totalPaid: 6120.5,
  currency: "MYR",
  ...over,
});

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

describe("scanToVaultForm", () => {
  it("fills every field it read, in the user's own currency without conversion", () => {
    const r = scanToVaultForm(fields(), { settings: myr, countries });
    expect(r.patch).toEqual({ name: "Rantai tangan 916", weight: "12.5", purity: "916", paid: "6120.5", date: "2026-09-30" });
    expect(r.unread).toEqual([]);
    expect(r.unknownCurrency).toBeNull();
  });

  it("leaves unread fields out of the patch (so the form keeps what the user had) and lists them", () => {
    const r = scanToVaultForm(fields({ weightGrams: null, purchaseDate: null, itemName: null, purity: null }), { settings: myr, countries });
    expect(r.patch).toEqual({ paid: "6120.5" });
    expect(r.unread).toEqual(["weight", "purity", "date"]);
  });

  it("converts a receipt in another currency with the watchlist's rate into the base currency", () => {
    // 130 SGD = 100 USD (rate 1.3) = 450 MYR (rate 4.5)
    const r = scanToVaultForm(fields({ totalPaid: 130, currency: "SGD" }), { settings: myr, countries });
    expect(r.patch.paid).toBe("450");
    expect(scanToVaultForm(fields({ totalPaid: 130, currency: "SGD" }), { settings: usd, countries }).patch.paid).toBe("100");
  });

  it("USD needs no rate", () => {
    expect(scanToVaultForm(fields({ totalPaid: 100, currency: "USD" }), { settings: myr, countries }).patch.paid).toBe("450");
  });

  it("never guesses a rate: an unknown currency leaves the price blank and says which currency it was", () => {
    const r = scanToVaultForm(fields({ totalPaid: 5000, currency: "THB" }), { settings: myr, countries });
    expect(r.patch.paid).toBeUndefined();
    expect(r.unread).toContain("paid");
    expect(r.unknownCurrency).toBe("THB");
  });

  it("a receipt with no currency printed is taken to be in the user's own", () => {
    expect(scanToVaultForm(fields({ currency: null }), { settings: myr, countries }).patch.paid).toBe("6120.5");
  });

  it("no total on the receipt means no price in the form", () => {
    const r = scanToVaultForm(fields({ totalPaid: null }), { settings: myr, countries });
    expect(r.patch.paid).toBeUndefined();
    expect(r.unread).toEqual(["paid"]);
    expect(r.unknownCurrency).toBeNull();
  });

  it("rounds money to two decimals", () => {
    expect(scanToVaultForm(fields({ totalPaid: 100, currency: "SGD" }), { settings: myr, countries }).patch.paid).toBe("346.15");
  });
});

describe("the Worker's answer is validated before it touches the form", () => {
  const good = { ok: true, readable: true, confidence: "high", fields: fields() };
  it("accepts a well-formed answer", () => expect(scanResponseSchema.safeParse(good).success).toBe(true));
  it.each([
    ["a purity the app does not know", { ...good, fields: fields({ purity: "925" as never }) }],
    ["a negative weight", { ...good, fields: fields({ weightGrams: -1 }) }],
    ["a malformed date", { ...good, fields: fields({ purchaseDate: "30/09/2026" }) }],
    ["a currency that is not a 3-letter code", { ...good, fields: fields({ currency: "ringgit" }) }],
    ["an error body", { ok: false, error: "scanner_busy" }],
  ])("rejects %s", (_n, body) => expect(scanResponseSchema.safeParse(body).success).toBe(false));
});

describe("requestScan", () => {
  const ok = { ok: true, readable: true, confidence: "high", fields: fields() };
  const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("posts the photo, its type and the Turnstile token as JSON", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify(ok)))) as unknown as typeof fetch;
    const res = await requestScan("QUJD", "image/jpeg", "tok-1", spy, "https://x/scan");
    expect(res).toMatchObject({ ok: true, readable: true });
    expect(seen?.url).toBe("https://x/scan");
    expect(seen?.init.method).toBe("POST");
    expect(JSON.parse(String(seen?.init.body))).toEqual({ image: "QUJD", mimeType: "image/jpeg", turnstileToken: "tok-1" });
  });

  it("sends the visitor's own Gemini key in a header only when there is one, never in the body or the URL", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(JSON.stringify(ok)))) as unknown as typeof fetch;
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
    expect(await requestScan("a", "image/jpeg", "t", reply({ ok: true, fields: {} }), "https://x")).toEqual({ ok: false, error: "bad_answer" });
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
