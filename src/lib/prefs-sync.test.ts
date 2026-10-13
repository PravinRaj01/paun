import { describe, expect, it } from "vitest";
import { DEFAULT_COUNTRIES, DEFAULT_SETTINGS, type Country, type Settings } from "./gold";
import { applyPrefs, canonicalJson, mergePrefs, parsePrefs, pickPrefs, sanitizeWatchlist } from "./prefs-sync";

const settings: Settings = { ...DEFAULT_SETTINGS, spotUsdOz: 4321, apiKey: "goldapi-secret", source: "live", updatedAt: "2026-10-09T01:00:00Z", language: "ms", baseCurrency: "MYR", baseRate: 4.5, decimals: 3, mode: "pro", priceBasis: "raw", livePromptSeen: true };

describe("pickPrefs: only the whitelisted fields can leave the device", () => {
  it("takes language, currency, rate, decimals, basis, mode and theme", () => {
    expect(pickPrefs(settings, "light")).toEqual({ language: "ms", baseCurrency: "MYR", baseRate: 4.5, decimals: 3, priceBasis: "raw", mode: "pro", theme: "light" });
  });

  it("never the price, its source, any key, or the pop-up memory (checked on the whole serialised text)", () => {
    const text = JSON.stringify(pickPrefs(settings, "dark"));
    for (const secret of ["4321", "goldapi-secret", "live", "spotUsdOz", "apiKey", "source", "livePromptSeen", "updatedAt"]) expect(text).not.toContain(secret);
  });
});

describe("parsePrefs", () => {
  it("keeps valid fields and drops invalid or unknown ones, instead of failing whole", () => {
    expect(parsePrefs({ language: "fr", baseCurrency: "myr", baseRate: -1, decimals: 9, priceBasis: "raw", mode: "pro", theme: "blue", spotUsdOz: 1, apiKey: "x" })).toEqual({ priceBasis: "raw", mode: "pro" });
  });
  it.each([null, undefined, "text", 42, []])("a non-object (%j) gives nothing", (raw) => expect(parsePrefs(raw)).toEqual({}));
});

describe("applyPrefs: received settings can change only the whitelisted fields", () => {
  it("changes language, currency, rate, decimals, basis and mode, and leaves every other setting alone", () => {
    const out = applyPrefs(settings, { language: "en", baseCurrency: "SGD", baseRate: 1.3, decimals: 1, priceBasis: "retail", mode: "simple" });
    expect(out).toMatchObject({ language: "en", baseCurrency: "SGD", baseRate: 1.3, decimals: 1, priceBasis: "retail", mode: "simple" });
    expect([out.spotUsdOz, out.apiKey, out.source, out.updatedAt, out.livePromptSeen]).toEqual([4321, "goldapi-secret", "live", "2026-10-09T01:00:00Z", true]);
  });

  it("ignores anything outside the whitelist even if a server (or an attacker) sends it", () => {
    const sneaky = { language: "en", spotUsdOz: 1, apiKey: "stolen", source: "manual", livePromptSeen: false } as never;
    const out = applyPrefs(settings, sneaky);
    expect([out.spotUsdOz, out.apiKey, out.source, out.livePromptSeen]).toEqual([4321, "goldapi-secret", "live", true]);
    expect(out.language).toBe("en");
  });

  it("a partial update (an older device without some fields) leaves the others as they are", () => {
    expect(applyPrefs(settings, { language: "en" })).toMatchObject({ language: "en", baseCurrency: "MYR", decimals: 3 });
  });
});

describe("mergePrefs", () => {
  it("is the local preferences with the received ones on top", () => {
    expect(mergePrefs({ language: "ms", decimals: 2 }, { language: "en" })).toEqual({ language: "en", decimals: 2 });
  });
});

describe("sanitizeWatchlist", () => {
  it("keeps valid countries, including an optional shop mark-up", () => {
    const w = sanitizeWatchlist(DEFAULT_COUNTRIES, ["sg"]);
    expect(w.countries).toHaveLength(DEFAULT_COUNTRIES.length);
    expect(w.excluded).toEqual(["sg"]);
    expect(w.countries[0]).toEqual({ id: "my", name: "Malaysia", currency: "MYR", rate: 4.45, duty: 0, tax: 0, premium: 6 });
  });

  it("leaves out a country that would be refused (a zero rate, a bad currency, a repeated id) so it cannot block the rest", () => {
    const bad: Country[] = [
      { id: "ok", name: "Fine", currency: "MYR", rate: 4, duty: 0, tax: 0 },
      { id: "zero", name: "Zero rate", currency: "SGD", rate: 0, duty: 0, tax: 0 },
      { id: "cur", name: "Bad currency", currency: "ringgit", rate: 4, duty: 0, tax: 0 },
      { id: "ok", name: "Repeated id", currency: "SGD", rate: 1, duty: 0, tax: 0 },
      { id: "duty", name: "Silly duty", currency: "INR", rate: 80, duty: 500, tax: 0 },
    ];
    expect(sanitizeWatchlist(bad, []).countries.map((c) => c.id)).toEqual(["ok"]);
  });

  it("drops odd excluded ids and caps the lists", () => {
    expect(sanitizeWatchlist([], ["sg", "../x", "my"]).excluded).toEqual(["sg", "my"]);
    const many: Country[] = Array.from({ length: 80 }, (_v, i) => ({ id: `c${i}`, name: "N", currency: "MYR", rate: 1, duty: 0, tax: 0 }));
    expect(sanitizeWatchlist(many, []).countries).toHaveLength(60);
  });
});

describe("canonicalJson", () => {
  it("is the same text for equal values whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }));
  });
  it("differs when a value differs", () => expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 })));
});
