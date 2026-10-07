import { useEffect, useState } from "react";
import { z } from "zod";
import { hasDefaultSpot, type Settings } from "./gold";

/**
 * The shared near-live gold price, for the LANDING PAGE only (PLAN.md 3B). The `paun-api` Worker refreshes it every 15 minutes on
 * weekdays and serves it from its own storage; this file only reads it. Inside the app the price stays the latest daily close
 * (or the user's own GoldAPI key), so a visitor can never spend the owner's GoldAPI quota.
 *
 * Times are real moments (ISO, UTC); the page shows them through `formatMoment` / `formatAgo` in the viewer's own timezone.
 */
export const SPOT_URL = "https://paun-api.paun-gold.workers.dev/spot";
const TIMEOUT_MS = 6000;
export const POLL_MS = 5 * 60_000;

export const spotFeedSchema = z.object({
  priceUsdOz: z.number().positive(),
  fetchedAt: z.string(),
  marketTime: z.string().nullable(),
  provider: z.enum(["yahoo", "goldapi"]),
  ageSeconds: z.number(),
  marketOpen: z.boolean().nullable(),
  stale: z.boolean(),
});
export type SpotFeed = z.infer<typeof spotFeedSchema>;

export async function fetchSpotFeed(fetchImpl: typeof fetch = fetch, url: string = SPOT_URL): Promise<SpotFeed> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return spotFeedSchema.parse(await res.json());
}

export type FeedStatus = "live" | "closed" | "delayed";

const MIN = 60_000;
const OPEN_WITHIN_MS = 30 * MIN;
const DELAYED_AFTER_MS = 45 * MIN;
const isWeekday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

/**
 * live    the price was struck in the last 30 minutes
 * delayed it was not, on a weekday, and the last refresh is over 45 minutes old: the refresh job looks broken
 * closed  anything else (a weekend, the daily break): the last price is the last trade
 * Judged against the viewer's clock, because the page can stay open for hours after the answer was cached.
 */
export function feedStatus(feed: SpotFeed, now: Date): FeedStatus {
  const struck = Date.parse(feed.marketTime ?? feed.fetchedAt);
  if (now.getTime() - struck <= OPEN_WITHIN_MS) return "live";
  if (isWeekday(now) && now.getTime() - Date.parse(feed.fetchedAt) > DELAYED_AFTER_MS) return "delayed";
  return "closed";
}

export type LandingSpot =
  | { kind: "yours"; usdOz: number } // the user set a price or uses their own key: never overridden
  | { kind: "feed"; usdOz: number; feed: SpotFeed }
  | { kind: "close"; usdOz: number } // following the latest daily close
  | { kind: "pending"; usdOz: number }; // nothing has loaded yet; usdOz is only the untouched placeholder

/** Which price the landing page shows. The shared feed replaces only the automatic close, never a price the user chose. */
export function chooseLandingSpot(settings: Settings, feed: SpotFeed | null): LandingSpot {
  const placeholder = hasDefaultSpot(settings);
  if (settings.source !== "market" && !placeholder) return { kind: "yours", usdOz: settings.spotUsdOz };
  if (feed) return { kind: "feed", usdOz: feed.priceUsdOz, feed };
  return placeholder ? { kind: "pending", usdOz: settings.spotUsdOz } : { kind: "close", usdOz: settings.spotUsdOz };
}

/** Client-only (runs in effects, so server rendering never touches the network). Re-reads every 5 minutes; `now` ticks each minute. */
export function useSpotFeed(): { feed: SpotFeed | null; now: Date } {
  const [feed, setFeed] = useState<SpotFeed | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSpotFeed().then(
        (f) => alive && setFeed(f),
        () => {}, // keep whatever we had; the page falls back to the latest close and says so
      );
    void load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(new Date()), MIN);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);
  return { feed, now };
}
