import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./gold";
import { chooseLandingSpot, fetchSpotFeed, feedStatus, spotFeedSchema, type SpotFeed } from "./spot-feed";

const feed = (over: Partial<SpotFeed> = {}): SpotFeed => ({
  priceUsdOz: 4138.9,
  fetchedAt: "2026-10-07T16:30:54.273Z",
  marketTime: "2026-10-07T16:20:39.000Z",
  provider: "yahoo",
  ageSeconds: 109,
  marketOpen: true,
  stale: false,
  ...over,
});
const at = (iso: string) => new Date(iso);
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe("feedStatus (judged on the viewer's clock, not the cached answer)", () => {
  it("live: the price was struck in the last 30 minutes", () => {
    expect(feedStatus(feed(), at("2026-10-07T16:40:00Z"))).toBe("live");
    expect(feedStatus(feed(), at("2026-10-07T16:50:39Z"))).toBe("live"); // exactly 30 min after it was struck
  });

  it("goes quiet a few minutes later without being called broken (the daily break, a missed run)", () => {
    expect(feedStatus(feed(), at("2026-10-07T17:00:00Z"))).toBe("closed"); // struck 40 min ago, fetched 29 min ago
  });

  it("delayed: weekday, and the last refresh is over 45 minutes old", () => {
    expect(feedStatus(feed(), at("2026-10-07T17:30:00Z"))).toBe("delayed");
  });

  it("closed, not delayed, at the weekend: the last price is simply the last trade", () => {
    const friday = feed({ fetchedAt: "2026-10-09T23:45:00Z", marketTime: "2026-10-09T21:59:00Z" });
    expect(feedStatus(friday, at("2026-10-10T12:00:00Z"))).toBe("closed"); // Saturday
    expect(feedStatus(friday, at("2026-10-11T12:00:00Z"))).toBe("closed"); // Sunday
  });

  it("uses the fetch time when the provider gave no market time", () => {
    const backup = feed({ marketTime: null, provider: "goldapi" });
    expect(feedStatus(backup, at("2026-10-07T16:50:00Z"))).toBe("live");
    expect(feedStatus(backup, at("2026-10-07T17:40:00Z"))).toBe("delayed");
  });
});

describe("chooseLandingSpot", () => {
  const followingClose = settings({ source: "market", spotUsdOz: 4165.7, updatedAt: "2026-10-07T03:00:00Z" });

  it("uses the shared feed when the user follows the daily close", () => {
    expect(chooseLandingSpot(followingClose, feed())).toMatchObject({ kind: "feed", usdOz: 4138.9 });
  });

  it("falls back to the latest close when the feed is unavailable", () => {
    expect(chooseLandingSpot(followingClose, null)).toEqual({ kind: "close", usdOz: 4165.7 });
  });

  it("never overrides a price the user set or their own key's price", () => {
    const manual = settings({ source: "manual", spotUsdOz: 4000, updatedAt: "2026-10-07T03:00:00Z" });
    const live = settings({ source: "live", spotUsdOz: 4150, updatedAt: "2026-10-07T03:00:00Z", apiKey: "k" });
    expect(chooseLandingSpot(manual, feed())).toEqual({ kind: "yours", usdOz: 4000 });
    expect(chooseLandingSpot(live, feed())).toEqual({ kind: "yours", usdOz: 4150 });
  });

  it("a brand-new visitor (untouched placeholder) gets the feed, or is told it is still pending", () => {
    expect(chooseLandingSpot(settings(), feed())).toMatchObject({ kind: "feed" });
    expect(chooseLandingSpot(settings(), null)).toMatchObject({ kind: "pending" });
  });
});

describe("the feed's answer is validated", () => {
  it("accepts what the Worker sends", () => {
    expect(spotFeedSchema.parse(feed())).toEqual(feed());
  });

  it.each([
    ["no price", { ...feed(), priceUsdOz: undefined }],
    ["a price of zero", feed({ priceUsdOz: 0 })],
    ["a price that is text", { ...feed(), priceUsdOz: "4138" }],
    ["an unknown provider", { ...feed(), provider: "bloomberg" }],
    ["an error body", { error: "no_price_yet" }],
  ])("rejects %s", (_n, body) => expect(spotFeedSchema.safeParse(body).success).toBe(false));
});

describe("fetchSpotFeed", () => {
  const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the parsed feed", async () => {
    expect((await fetchSpotFeed(reply(feed()), "https://x/spot")).priceUsdOz).toBe(4138.9);
  });

  it("throws on 503 (no price yet), so the page falls back to the latest close", async () => {
    await expect(fetchSpotFeed(reply({ error: "no_price_yet" }, 503), "https://x/spot")).rejects.toThrow("503");
  });

  it("throws on a malformed answer instead of showing a wrong price", async () => {
    await expect(fetchSpotFeed(reply({ priceUsdOz: "oops" }), "https://x/spot")).rejects.toThrow();
  });
});
