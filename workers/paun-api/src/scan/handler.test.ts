import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../index";
import { fakeFetch, testEnv } from "../test-kit";
import { checkScanLimits } from "./limits";

const NOW = new Date("2026-10-08T01:00:00Z");
const ORIGIN = "https://paun-web.paun-gold.workers.dev";
const IMG = "/9j/" + "A".repeat(400); // looks like a JPEG to the format check; never decoded

beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const modelAnswer = (over: Record<string, unknown> = {}) => ({
  readable: true,
  item_name: "Rantai tangan 916",
  purity: "916",
  weight_grams: 12.5,
  making_fee_amount: 8,
  making_fee_per: "gram",
  purchase_date: "2026-09-30",
  total_paid: 6120.5,
  currency: "MYR",
  confidence: "high",
  ...over,
});
const gemini = (answer: unknown = modelAnswer()) => () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }] }));
const turnstileOk = () => new Response(JSON.stringify({ success: true }));
const turnstileNo = () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }));
const configured = () => testEnv({ GEMINI_API_KEY: "g-key-123", TURNSTILE_SECRET: "t-secret-456" });

const post = (
  env = configured(),
  f = fakeFetch({ turnstile: turnstileOk, gemini: gemini() }),
  body: unknown = { image: IMG, mimeType: "image/jpeg", turnstileToken: "tok" },
  headers: Record<string, string> = { origin: ORIGIN, "cf-connecting-ip": "203.0.113.7" },
) =>
  handle(
    new Request("https://paun-api.paun-gold.workers.dev/scan", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    env,
    NOW,
    f.impl,
  ).then(async (res) => ({ res, json: (await res.json()) as Record<string, unknown>, f, env }));

describe("a good scan", () => {
  it("returns the sanitised fields, and sends Gemini the photo and the key in a header (not the URL)", async () => {
    const { res, json, f } = await post();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, readable: true, confidence: "high", fields: { purity: "916", weightGrams: 12.5, currency: "MYR" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const call = f.calls.find((c) => c.host.includes("generativelanguage"))!;
    expect(call.headers.get("x-goog-api-key")).toBe("g-key-123");
    expect(call.url).not.toContain("g-key-123");
    expect(call.url).toContain("gemini-3.5-flash-lite:generateContent");
    expect(call.body).toContain(IMG);
    expect(call.body).toContain('"responseMimeType":"application/json"');
  });

  it("uses the model from the GEMINI_MODEL variable when set", async () => {
    const env = testEnv({ GEMINI_API_KEY: "g", TURNSTILE_SECRET: "t", GEMINI_MODEL: "gemini-x-test" });
    const { f } = await post(env);
    expect(f.calls.find((c) => c.host.includes("generativelanguage"))!.url).toContain("gemini-x-test:generateContent");
  });

  it("checks the Turnstile token with the secret and the visitor's address", async () => {
    const { f } = await post();
    const t = f.calls.find((c) => c.host.includes("challenges.cloudflare"))!;
    const form = new URLSearchParams(t.body);
    expect(form.get("secret")).toBe("t-secret-456");
    expect(form.get("response")).toBe("tok");
    expect(form.get("remoteip")).toBe("203.0.113.7");
  });

  it("whatever the model gets wrong is nulled, not passed on", async () => {
    const f = fakeFetch({ turnstile: turnstileOk, gemini: gemini(modelAnswer({ purity: "925", weight_grams: -2, purchase_date: "2031-01-01" })) });
    const { json } = await post(configured(), f);
    expect(json["fields"]).toMatchObject({ purity: null, weightGrams: null, purchaseDate: null, totalPaid: 6120.5 });
  });

  it("a photo that is not a receipt comes back unreadable, with every field null", async () => {
    const f = fakeFetch({ turnstile: turnstileOk, gemini: gemini({ readable: false }) });
    const { res, json } = await post(configured(), f);
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, readable: false });
    expect(Object.values(json["fields"] as object).every((v) => v === null)).toBe(true);
  });
});

describe("refusals before any money is spent", () => {
  it("another website's origin is refused without touching Turnstile or Gemini", async () => {
    const { res, json, f } = await post(configured(), fakeFetch({}), undefined, { origin: "https://evil.example" });
    expect([res.status, json["error"]]).toEqual([403, "forbidden_origin"]);
    expect(f.calls).toHaveLength(0);
  });

  it("no Origin header at all (a script, not a page) is refused too", async () => {
    const { res } = await post(configured(), fakeFetch({}), undefined, {});
    expect(res.status).toBe(403);
  });

  it("answers 503 scanner_not_configured while the secrets are not set, so deploying first is safe", async () => {
    for (const env of [testEnv(), testEnv({ GEMINI_API_KEY: "g" }), testEnv({ TURNSTILE_SECRET: "t" })]) {
      const { res, json, f } = await post(env, fakeFetch({}));
      expect([res.status, json["error"]]).toEqual([503, "scanner_not_configured"]);
      expect(f.calls).toHaveLength(0);
    }
  });

  it.each([
    ["not JSON", "{oops", "body"],
    ["a wrong image type", { image: IMG, mimeType: "image/gif", turnstileToken: "t" }, "mimeType"],
    ["a missing token", { image: IMG, mimeType: "image/jpeg" }, "turnstileToken"],
    ["an empty token", { image: IMG, mimeType: "image/jpeg", turnstileToken: "" }, "turnstileToken"],
    ["a huge token", { image: IMG, mimeType: "image/jpeg", turnstileToken: "x".repeat(3000) }, "turnstileToken"],
    ["an image that is not base64", { image: "not base64 !!!" + "A".repeat(300), mimeType: "image/jpeg", turnstileToken: "t" }, "image"],
    ["a tiny image", { image: "/9j/AAAA", mimeType: "image/jpeg", turnstileToken: "t" }, "image"],
    ["a file that is not the image it claims to be", { image: "iVBORw0KGgo" + "A".repeat(300), mimeType: "image/jpeg", turnstileToken: "t" }, "image"],
    ["a missing image", { mimeType: "image/jpeg", turnstileToken: "t" }, "image"],
  ])("rejects %s with 400 and says which field", async (_n, body, field) => {
    const { res, json, f } = await post(configured(), fakeFetch({}), body);
    expect([res.status, json["error"], json["field"]]).toEqual([400, "invalid_request", field]);
    expect(f.calls).toHaveLength(0);
  });

  it("rejects a body over the size limit with 413", async () => {
    const { res } = await post(configured(), fakeFetch({}), { image: "/9j/" + "A".repeat(1_600_000), mimeType: "image/jpeg", turnstileToken: "t" });
    expect(res.status).toBe(413);
  });

  it("a failed Turnstile check stops everything: the AI is never called and no cap is used", async () => {
    const f = fakeFetch({ turnstile: turnstileNo, gemini: gemini() });
    const { res, json, env } = await post(configured(), f);
    expect([res.status, json["error"]]).toEqual([403, "turnstile_failed"]);
    expect(f.count("generativelanguage")).toBe(0);
    expect([...env.SPOT.data.keys()].filter((k) => k.startsWith("scan:"))).toEqual([]);
  });

  it("Cloudflare's check being down is a 502, and the AI is still not called", async () => {
    const f = fakeFetch({ turnstile: () => new TypeError("fetch failed"), gemini: gemini() });
    const { res, json } = await post(configured(), f);
    expect([res.status, json["error"]]).toEqual([502, "verification_unavailable"]);
    expect(f.count("generativelanguage")).toBe(0);
  });
});

describe("the caps", () => {
  it("a visitor gets 10 scans an hour, then 429, and nothing more is spent", async () => {
    const env = configured();
    const f = fakeFetch({ turnstile: turnstileOk, gemini: gemini() });
    for (let i = 0; i < 10; i++) expect((await post(env, f)).res.status).toBe(200);
    const eleventh = await post(env, f);
    expect([eleventh.res.status, eleventh.json["error"]]).toEqual([429, "rate_limited"]);
    expect(f.count("generativelanguage")).toBe(10);
    expect(f.count("challenges.cloudflare")).toBe(10); // the 11th did not even use up a Turnstile token
  });

  it("another visitor is not affected by the first one's limit", async () => {
    const env = configured();
    const f = fakeFetch({ turnstile: turnstileOk, gemini: gemini() });
    for (let i = 0; i < 10; i++) await post(env, f);
    const other = await post(env, f, undefined, { origin: ORIGIN, "cf-connecting-ip": "198.51.100.9" });
    expect(other.res.status).toBe(200);
  });

  it("the global daily cap answers 503 scanner_busy without calling the AI", async () => {
    const env = testEnv({ GEMINI_API_KEY: "g", TURNSTILE_SECRET: "t", SCAN_DAILY_CAP: "2" });
    const f = fakeFetch({ turnstile: turnstileOk, gemini: gemini() });
    await post(env, f, undefined, { origin: ORIGIN, "cf-connecting-ip": "1.1.1.1" });
    await post(env, f, undefined, { origin: ORIGIN, "cf-connecting-ip": "2.2.2.2" });
    const third = await post(env, f, undefined, { origin: ORIGIN, "cf-connecting-ip": "3.3.3.3" });
    expect([third.res.status, third.json["error"]]).toEqual([503, "scanner_busy"]);
    expect(f.count("generativelanguage")).toBe(2);
  });

  it("a scan whose AI call fails still counts (the cap is reserved before the call)", async () => {
    const env = configured();
    const f = fakeFetch({ turnstile: turnstileOk, gemini: () => new Response("{}", { status: 500 }) });
    await post(env, f);
    expect(env.SPOT.data.get("scan:day:2026-10-08")).toBe("1");
  });

  it("the counters restart each day and each hour, and no raw IP address is ever stored", async () => {
    const env = testEnv({ SCAN_PER_VISITOR_HOUR: "1" });
    const first = await checkScanLimits(env, "203.0.113.7", NOW);
    expect(first.ok).toBe(true);
    if (first.ok) await first.reserve();
    expect((await checkScanLimits(env, "203.0.113.7", NOW)).ok).toBe(false);
    expect((await checkScanLimits(env, "203.0.113.7", new Date("2026-10-08T02:00:00Z"))).ok).toBe(true); // next hour
    expect([...env.SPOT.data.keys()].join(" ")).not.toContain("203.0.113.7");
  });

  it("garbage in the cap variables falls back to the defaults (200 a day, 10 an hour)", async () => {
    const env = testEnv({ SCAN_DAILY_CAP: "lots", SCAN_PER_VISITOR_HOUR: "-4" });
    for (let i = 0; i < 10; i++) {
      const c = await checkScanLimits(env, "9.9.9.9", NOW);
      expect(c.ok).toBe(true);
      if (c.ok) await c.reserve();
    }
    expect((await checkScanLimits(env, "9.9.9.9", NOW)).ok).toBe(false);
  });
});

describe("when Gemini misbehaves", () => {
  it.each([
    ["an HTTP error", () => new Response("{}", { status: 429 }), 502, "scanner_unavailable"],
    ["an empty answer", () => new Response(JSON.stringify({ candidates: [] })), 502, "scanner_unavailable"],
    ["an answer that is not JSON", () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sorry, I cannot" }] } }] })), 502, "scanner_unavailable"],
    ["a safety block", () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })), 422, "image_rejected"],
    ["a network failure", () => new TypeError("fetch failed"), 502, "scanner_unavailable"],
  ])("%s", async (_n, route, status, error) => {
    const { res, json } = await post(configured(), fakeFetch({ turnstile: turnstileOk, gemini: route }));
    expect([res.status, json["error"]]).toEqual([status, error]);
  });

  it("JSON wrapped in a code fence is still read", async () => {
    const fenced = () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(modelAnswer()) + "\n```" }] } }] }));
    const { json } = await post(configured(), fakeFetch({ turnstile: turnstileOk, gemini: fenced }));
    expect(json).toMatchObject({ ok: true, readable: true });
  });
});

describe("privacy", () => {
  it("nothing the user sent or the model read, and no key, ever reaches the log", async () => {
    const spy = vi.mocked(console.log);
    const answer = modelAnswer({ item_name: "SECRET-ITEM-NAME" });
    await post(configured(), fakeFetch({ turnstile: turnstileOk, gemini: gemini(answer) }));
    await post(configured(), fakeFetch({ turnstile: turnstileNo }));
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain("scan:");
    for (const secret of ["SECRET-ITEM-NAME", "g-key-123", "t-secret-456", "tok", IMG.slice(0, 40), "203.0.113.7"]) expect(logged).not.toContain(secret);
  });

  it("a response never contains the photo", async () => {
    const { json } = await post();
    expect(JSON.stringify(json)).not.toContain("AAAA");
    expect(Object.keys(json).sort()).toEqual(["confidence", "fields", "items", "ok", "readable", "receipt"]);
  });

  it("only POST is allowed on /scan, and the browser's preflight check is answered", async () => {
    const env = configured();
    const get = await handle(new Request("https://x/scan", { method: "GET" }), env, NOW);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");
    const pre = await handle(new Request("https://x/scan", { method: "OPTIONS", headers: { origin: ORIGIN } }), env, NOW);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect(pre.headers.get("access-control-allow-headers")).toBe("content-type, x-gemini-key, authorization");
  });
});

describe("the visitor's own Gemini key (x-gemini-key)", () => {
  const OWN = "AIzaSyOwnKeyForTesting_1234567890abcd";
  const withKey = (extra: Record<string, string> = {}) => ({ origin: ORIGIN, "cf-connecting-ip": "203.0.113.7", "x-gemini-key": OWN, ...extra });
  const ok = () => fakeFetch({ turnstile: turnstileOk, gemini: gemini() });

  it("is used for Google instead of Paun's key, and the answer is the same", async () => {
    const f = ok();
    const { res, json } = await post(configured(), f, undefined, withKey());
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, readable: true });
    const call = f.calls.find((c) => c.host.includes("generativelanguage"))!;
    expect(call.headers.get("x-goog-api-key")).toBe(OWN);
    expect(call.headers.get("x-goog-api-key")).not.toBe("g-key-123");
    expect(call.url).not.toContain(OWN);
  });

  it("makes the scanner work even when Paun's own key is not configured; without it the scanner stays off", async () => {
    const onlyTurnstile = () => testEnv({ TURNSTILE_SECRET: "t-secret-456" });
    expect((await post(onlyTurnstile(), ok(), undefined, withKey())).res.status).toBe(200);
    const none = await post(onlyTurnstile(), fakeFetch({}));
    expect([none.res.status, none.json["error"]]).toEqual([503, "scanner_not_configured"]);
  });

  it("skips Paun's shared daily cap (and does not count against it), but keeps the per-visitor hourly limit", async () => {
    const env = testEnv({ GEMINI_API_KEY: "g", TURNSTILE_SECRET: "t", SCAN_DAILY_CAP: "1", SCAN_PER_VISITOR_HOUR: "3" });
    const f = ok();
    const other = (ip: string) => ({ origin: ORIGIN, "cf-connecting-ip": ip });
    expect((await post(env, f, undefined, other("1.1.1.1"))).res.status).toBe(200); // uses the whole shared cap
    expect((await post(env, f, undefined, other("2.2.2.2"))).json["error"]).toBe("scanner_busy");
    expect((await post(env, f, undefined, withKey({ "cf-connecting-ip": "2.2.2.2" }))).res.status).toBe(200); // own key: still allowed
    expect(env.SPOT.data.get("scan:day:2026-10-08")).toBe("1"); // and it did not use up the shared count
    // the hourly limit still applies to own-key scans
    await post(env, f, undefined, withKey({ "cf-connecting-ip": "3.3.3.3" }));
    await post(env, f, undefined, withKey({ "cf-connecting-ip": "3.3.3.3" }));
    await post(env, f, undefined, withKey({ "cf-connecting-ip": "3.3.3.3" }));
    const fourth = await post(env, f, undefined, withKey({ "cf-connecting-ip": "3.3.3.3" }));
    expect([fourth.res.status, fourth.json["error"]]).toEqual([429, "rate_limited"]);
  });

  it.each(["short", "has spaces in it which is not a key at all", "bad*chars*in*the*key*1234567890", "x".repeat(300)])(
    "refuses a malformed key (%s) before anything is called",
    async (bad) => {
      const f = fakeFetch({});
      const { res, json } = await post(configured(), f, undefined, withKey({ "x-gemini-key": bad }));
      expect([res.status, json["error"], json["field"]]).toEqual([400, "invalid_request", "geminiKey"]);
      expect(f.calls).toHaveLength(0);
    },
  );

  it.each([[400], [401], [403]])("Google answering %i to the visitor's key is reported as user_key_rejected (422)", async (status) => {
    const f = fakeFetch({ turnstile: turnstileOk, gemini: () => new Response("{}", { status }) });
    const { res, json } = await post(configured(), f, undefined, withKey());
    expect([res.status, json["error"]]).toEqual([422, "user_key_rejected"]);
  });

  it("Google answering 429 is user_key_quota (429); other failures stay a generic 502", async () => {
    const quota = fakeFetch({ turnstile: turnstileOk, gemini: () => new Response("{}", { status: 429 }) });
    expect(await post(configured(), quota, undefined, withKey()).then((r) => [r.res.status, r.json["error"]])).toEqual([429, "user_key_quota"]);
    const boom = fakeFetch({ turnstile: turnstileOk, gemini: () => new Response("{}", { status: 500 }) });
    expect(await post(configured(), boom, undefined, withKey()).then((r) => [r.res.status, r.json["error"]])).toEqual([502, "scanner_unavailable"]);
  });

  it("the same Google errors with PAUN's key are never blamed on the visitor", async () => {
    for (const status of [400, 401, 403, 429]) {
      const f = fakeFetch({ turnstile: turnstileOk, gemini: () => new Response("{}", { status }) });
      const { res, json } = await post(configured(), f);
      expect([res.status, json["error"]]).toEqual([502, "scanner_unavailable"]);
    }
  });

  it("the key never appears in a log line or in any response, success or failure", async () => {
    const spy = vi.mocked(console.log);
    const bodies: string[] = [];
    for (const gem of [gemini(), () => new Response("{}", { status: 403 }), () => new Response("{}", { status: 429 }), () => new Response("{}", { status: 500 })]) {
      const { res } = await post(configured(), fakeFetch({ turnstile: turnstileOk, gemini: gem }), undefined, withKey()).then(async (r) => ({ res: r.json }));
      bodies.push(JSON.stringify(res));
    }
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain("own key");
    expect(logged).not.toContain(OWN);
    expect(logged).not.toContain("AIzaSy");
    expect(bodies.join("\n")).not.toContain(OWN);
  });

  it("the browser's permission check allows the header", async () => {
    const pre = await handle(new Request("https://x/scan", { method: "OPTIONS", headers: { origin: ORIGIN } }), configured(), NOW);
    expect(pre.headers.get("access-control-allow-headers")).toBe("content-type, x-gemini-key, authorization");
  });
});
