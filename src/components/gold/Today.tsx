import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "./shell-context";
import { formatAgo, formatCalendarDate, formatMoment } from "@/lib/datetime";
import { useSnapshot } from "@/lib/forecast/snapshot";
import { baseRateOf, fmt, metalPerGram, type PurityId } from "@/lib/gold";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";
import { chooseLandingSpot, feedStatus, useSpotFeed } from "@/lib/spot-feed";

const OTHER_PURITIES: PurityId[] = ["999", "750"];
const PAUN_GRAMS = 8; // a South Indian trade unit, shown once and only as a convenience (PLAN.md: grams are the headline)

/** Today: what gold is worth per gram, in the display currency, with when and where the price is from; then the two jobs. */
export function Today() {
  const { settings, countries, hydrated, priceUnavailable } = useGold();
  const { openSettings } = useShell();
  const { language, t } = useI18n();
  const snap = useSnapshot();
  const { feed, now } = useSpotFeed();

  const spot = chooseLandingSpot(settings, feed);
  const status = spot.kind === "feed" ? feedStatus(spot.feed, now) : null;
  const fx = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;
  // The page is first drawn on the server with placeholder settings. A figure from them would be wrong, so say nothing until the
  // saved settings and a real price are in.
  const ready = hydrated && spot.kind !== "pending";
  // neither the live feed nor the daily file could be read and nothing was ever saved: say so, rather than wait for ever
  const failed = hydrated && spot.kind === "pending" && priceUnavailable;
  const per = (p: PurityId) => fmt(metalPerGram(p, spot.usdOz, fx), cur, settings.decimals);

  // short by default; the long form (instrument, provider, trading day) sits behind one tap
  const struck = spot.kind === "feed" ? (spot.feed.marketTime ?? spot.feed.fetchedAt) : null;
  const short =
    spot.kind === "feed" && struck
      ? status === "live"
        ? t("todayLive", { when: formatMoment(struck, language) })
        : t("todayClose", { when: formatMoment(struck, language) })
      : spot.kind === "close" && snap.status === "ready"
        ? t("todayCloseDate", { date: formatCalendarDate(snap.snapshot.asOf, language), tz: t("tzTradingDay") })
        : spot.kind === "yours"
          ? t("todayYours")
          : null;
  const full = (() => {
    if (spot.kind === "feed" && struck) {
      const head =
        status === "live" ? t("spotFeedLive", { ago: formatAgo(struck, now, language), when: formatMoment(struck, language) })
        : status === "closed" ? t("spotFeedClosed", { when: formatMoment(struck, language) })
        : t("spotFeedDelayed", { when: formatMoment(struck, language) });
      return `${head} · ${spot.feed.provider === "yahoo" ? t("spotFeedSourceYahoo") : t("spotFeedSourceGoldapi")}`;
    }
    if (spot.kind === "close" && snap.status === "ready")
      return t("spotFeedClose", { date: formatCalendarDate(snap.snapshot.asOf, language), tz: t("tzTradingDay") });
    return null;
  })();

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-gold">{t("todayTitle")}</p>
        {failed ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm">{t("todayUnavailable")}</p>
            <Button variant="outline" onClick={openSettings}>
              {t("moreOpenSettings")}
            </Button>
          </div>
        ) : ready ? (
          <>
            <div className="num mt-3 font-display text-5xl sm:text-6xl">{per("916")}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t("todayPerGram", { purity: "916" })}</p>
          </>
        ) : (
          <>
            <div className="mt-3 h-14 w-60 animate-pulse rounded-md bg-muted" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">{t("todayLoading")}</p>
          </>
        )}
      </div>

      {ready && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {OTHER_PURITIES.map((p) => (
              <div key={p} className="rounded-lg border bg-card p-4">
                <div className="num text-xl">{per(p)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t("todayPerGram", { purity: p })}</div>
              </div>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">{t("todayMetalNote")}</p>
          <p className="num text-xs text-muted-foreground">
            {t("todayPaun", { grams: PAUN_GRAMS, value: fmt(metalPerGram("916", spot.usdOz, fx) * PAUN_GRAMS, cur, settings.decimals) })}
          </p>
          {short && <p className="num text-xs text-muted-foreground">{short}</p>}
          {full && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">{t("todaySourceMore")}</summary>
              <p className="num mt-2">{full}</p>
            </details>
          )}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Button asChild size="lg" className="h-auto min-h-14 justify-between whitespace-normal py-3 text-left">
          <Link to="/dashboard" search={{ tab: "buy" }}>
            {t("todayCheckShop")} <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-auto min-h-14 justify-between whitespace-normal py-3 text-left">
          <Link to="/dashboard" search={{ tab: "sell" }}>
            {t("todaySelling")} <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t("todayDisclaimer")}</p>
    </section>
  );
}
