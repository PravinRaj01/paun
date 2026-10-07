import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Download, Globe2, Scale, Settings2, Shuffle } from "lucide-react";
import { Logo } from "@/components/gold/Logo";
import { GoldMap } from "@/components/gold/GoldMap";
import { Button } from "@/components/ui/button";
import { useGold } from "@/lib/gold-store";
import { fmt, GRAMS_PER_OUNCE } from "@/lib/gold";
import { formatAgo, formatCalendarDate, formatMoment } from "@/lib/datetime";
import { useSnapshot } from "@/lib/forecast/snapshot";
import { useI18n } from "@/lib/i18n";
import { chooseLandingSpot, feedStatus, useSpotFeed } from "@/lib/spot-feed";
import { GoldGuide } from "@/components/gold/GoldGuide";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paun — Know the true price of gold" },
      {
        name: "description",
        content: "A private gold trade desk: compare landed costs across countries, expose jeweler's premiums, find break-even prices.",
      },
      { property: "og:title", content: "Paun — Know the true price of gold" },
      {
        property: "og:description",
        content: "Compare landed gold costs across countries and see exactly what a jeweler is charging over spot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

type BIPEvent = Event & { prompt: () => Promise<void> };

function Landing() {
  const { settings } = useGold();
  const { language, setLanguage, t } = useI18n();
  const snap = useSnapshot();
  const { feed, now } = useSpotFeed();
  const [install, setInstall] = useState<BIPEvent | null>(null);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  // The landing page shows the shared near-live price when the feed answers; inside the app the price stays the latest close.
  // A price the user set, or their own key's, always wins.
  const spot = chooseLandingSpot(settings, feed);
  const status = spot.kind === "feed" ? feedStatus(spot.feed, now) : null;
  const perG = spot.usdOz / GRAMS_PER_OUNCE;
  const spotLine = (() => {
    if (spot.kind === "feed") {
      const struck = spot.feed.marketTime ?? spot.feed.fetchedAt;
      const when = formatMoment(struck, language); // the viewer's own timezone, named
      const head =
        status === "live" ? t("spotFeedLive", { ago: formatAgo(struck, now, language), when })
        : status === "closed" ? t("spotFeedClosed", { when })
        : t("spotFeedDelayed", { when });
      return `${head} · ${spot.feed.provider === "yahoo" ? t("spotFeedSourceYahoo") : t("spotFeedSourceGoldapi")}`;
    }
    if (spot.kind === "close" && snap.status === "ready")
      return t("spotFeedClose", { date: formatCalendarDate(snap.snapshot.asOf, language), tz: t("tzTradingDay") });
    if (spot.kind === "pending") return t("spotFeedPending");
    return null; // the user's own price needs no explanation here
  })();
  const priceWord =
    spot.kind === "yours" ? (settings.source === "live" ? t("live") : t("your"))
    : spot.kind === "feed" ? (status === "live" ? t("live") : t("closeWord"))
    : spot.kind === "close" ? t("closeWord")
    : "…";
  const features = language === "ms" ? [
    { icon: Globe2, title: "Senarai negara", body: "Pantau pasaran dengan mata wang, kadar tukaran, duti import dan cukai sendiri." },
    { icon: Scale, title: "Kalkulator emas", body: "Masukkan berat, ketulenan, upah dan kos lebur untuk melihat nilai emas bersih." },
    { icon: Shuffle, title: "Perbandingan negara", body: "Bandingkan barang emas yang sama dan lihat tempat paling sesuai untuk membeli atau menjual." },
    { icon: Settings2, title: "Data kekal milik anda", body: "Tanpa akaun. Tetapkan harga spot atau gunakan kunci API percuma untuk harga langsung." },
  ] : [
    { icon: Globe2, title: "Country watchlist", body: "Track any market with its own currency, exchange rate, import duty and VAT." },
    { icon: Scale, title: "Trade analyzer", body: "Weight, purity, making and melting fees in — net gold value and premium out." },
    { icon: Shuffle, title: "Spread & arbitrage", body: "The same piece priced everywhere you watch. Instantly see where to buy or sell." },
    { icon: Settings2, title: "Your data, your browser", body: "No account. Set spot manually or plug in a free API key for live prices." },
  ];

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="" width={28} height={28} className="rounded" />
          <Logo className="text-xl" />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded-full border p-0.5 text-[10px]">
            {(["en", "ms"] as const).map((code) => <button key={code} onClick={() => setLanguage(code)} className={`rounded-full px-2 py-1 ${language === code ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{code === "en" ? "EN" : "BM"}</button>)}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setGuide(true)} aria-label={t("guide")}><BookOpen className="h-4 w-4" /></Button>
          {install && (
            <Button variant="ghost" size="sm" onClick={() => install.prompt().then(() => setInstall(null))}>
              <Download className="h-4 w-4" /> <span className="hidden sm:inline">{t("install")}</span>
            </Button>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pb-16 md:pt-20">
        <p className="num text-xs uppercase tracking-[0.2em] text-gold">{t("homeEyebrow")} · {spot.kind === "pending" ? "…" : fmt(spot.usdOz, "USD")} / oz</p>
        {spotLine && <p className="num mt-2 text-[11px] text-muted-foreground">{spotLine}</p>}
        <h1 className="mt-5 max-w-4xl font-display text-4xl leading-[1.08] sm:text-5xl md:text-7xl">
          {t("homeTitleA")} <em className="text-gold">{t("homeTitleB")}</em> {t("homeTitleC")}
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:mt-6 sm:text-lg">
          {t("homeIntro")}
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Button asChild size="lg">
            <Link to="/dashboard">
              {t("openCalculator")} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">{t("noSignup")}</span>
        </div>
      </section>

      <section className="mx-auto -mt-5 max-w-6xl overflow-hidden px-4 pb-16 sm:-mt-8 sm:px-6 sm:pb-20">
        <div className="grid gap-1 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-gold">{t("worldGold")}</p>
          <p className="num text-xs text-muted-foreground">{t("basedOn")} {priceWord} · {(settings.priceBasis ?? "retail") === "retail" ? t("shopPrice") : t("rawSpot")}</p>
        </div>
        <GoldMap spotUsdOz={spot.usdOz} />
      </section>

      <section className="mx-auto grid max-w-6xl gap-px overflow-hidden px-4 py-14 sm:px-6 sm:py-20 md:grid-cols-2">
        {features.map((f, i) => (
          <div key={f.title} className="border-t py-8 md:pr-12">
            <div className="flex items-center gap-3">
              <span className="num text-xs text-muted-foreground">0{i + 1}</span>
              <f.icon className="h-4 w-4 text-gold" />
            </div>
            <h3 className="mt-3 font-display text-2xl">{f.title}</h3>
            <p className="mt-2 max-w-md text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="rounded-xl border bg-card p-5 sm:p-8 md:p-12">
          <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Example · 10 g 22K ring, Malaysia</p>
              <div className="num mt-4 grid grid-cols-2 gap-6 md:grid-cols-4">
                {[
                  ["Net gold", fmt(perG * 10 * (22 / 24), "USD")],
                  ["Making fee", fmt(40, "USD")],
                  ["Premium", `${(((perG * 10 * (22 / 24) + 45) / (perG * 10 * (22 / 24)) - 1) * 100).toFixed(1)}%`],
                  ["Break-even", `${fmt((perG * 10 * (22 / 24) + 45) / 10, "USD")}/g`],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-xs text-muted-foreground">{l}</div>
                    <div className="mt-1 text-xl">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/dashboard">Run your own <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        Paun · Estimates only, not financial advice. Data stays in your browser.
      </footer>
      <GoldGuide open={guide} onOpenChange={setGuide} />
    </div>
  );
}
