import { useMemo, useState } from "react";
import { useGold } from "@/lib/gold-store";
import { baseRateOf, fmt, GRAMS_PER_OUNCE } from "@/lib/gold";
import { buildForecast } from "@/lib/forecast/forecast";
import { useSnapshot } from "@/lib/forecast/snapshot";
import { useI18n } from "@/lib/i18n";

/**
 * "Where gold may be next week" - the P10-P90 price range from the volatility model, in plain language.
 *
 * Anchored to the MARKET CLOSE in the snapshot, not to the user's spot setting: that setting is a manual number
 * (default 2650) and bands built on a stale spot would be nonsense. Regime probabilities are intentionally not shown:
 * they only appear when Model A passed every ship rule (forecast.regime.shipped), which is currently not the case.
 */
export function ForecastCard() {
  const { settings, setSettings, countries } = useGold();
  const { t } = useI18n();
  const state = useSnapshot();
  const [unit, setUnit] = useState<"g" | "oz">("g");
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;

  const forecast = useMemo(
    () => (state.status === "ready" ? buildForecast(state.snapshot) : null),
    [state],
  );
  const seg = (on: boolean) =>
    `whitespace-nowrap rounded px-2 py-1 ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;

  const shell = (body: React.ReactNode) => (
    <section className="rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="forecast-title">
      {body}
    </section>
  );
  const heading = (
    <div>
      <h2 id="forecast-title" className="font-display text-xl sm:text-2xl">
        {t("forecastTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("forecastHint")}</p>
    </div>
  );

  if (state.status === "loading")
    return shell(
      <>
        {heading}
        <div
          className="mt-6 h-24 animate-pulse rounded-md bg-muted/50"
          role="status"
          aria-label={t("forecastLoading")}
        />
      </>,
    );
  if (state.status === "error" || !forecast)
    return shell(
      <>
        {heading}
        <p className="mt-4 text-sm text-muted-foreground">{t("forecastUnavailable")}</p>
      </>,
    );

  const k = base / (unit === "g" ? GRAMS_PER_OUNCE : 1); // USD/oz -> chosen unit in the display currency
  const price = (usdOz: number) => fmt(usdOz * k, cur, settings.decimals);
  const { q10: lo, q50: mid, q90: hi } = forecast.bands;
  const spot = forecast.spotUsdOz;
  const pad = (hi - lo) * 0.18;
  const min = Math.min(lo, spot) - pad;
  const max = Math.max(hi, spot) + pad;
  const pos = (v: number) => `${(((v - min) / (max - min)) * 100).toFixed(2)}%`;
  // The user's own spot differs a lot from the market close this range is built on: offer to follow the close.
  const farFromClose =
    settings.source !== "market" &&
    Math.abs(settings.spotUsdOz - forecast.snapshotSpotUsdOz) / forecast.snapshotSpotUsdOz > 0.03;
  const followMarketClose = () =>
    setSettings((s) => ({
      ...s,
      spotUsdOz: forecast.snapshotSpotUsdOz,
      source: "market",
      updatedAt: new Date().toISOString(),
    }));
  const unitLabel = unit === "g" ? t("perGram") : t("perOunce");

  return shell(
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="unit">
          {(["g", "oz"] as const).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={seg(unit === u)}
            >
              /{u}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-5 text-sm sm:text-base">
        {t("forecastRange")} <span className="num text-gold">{price(lo)}</span> {t("forecastAnd")}{" "}
        <span className="num text-gold">{price(hi)}</span>
        <span className="text-muted-foreground"> {unitLabel}</span>
      </p>

      {/* the range: shaded = likely zone, tick = middle estimate, ring = market close */}
      <div
        className="relative mt-7 h-10"
        role="img"
        aria-label={`${price(lo)} – ${price(hi)} ${unitLabel}`}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-border" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-primary/25"
          style={{ left: pos(lo), width: `${(((hi - lo) / (max - min)) * 100).toFixed(2)}%` }}
        />
        <div
          className="absolute top-1/2 h-6 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-primary"
          style={{ left: pos(mid) }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background"
          style={{ left: pos(spot) }}
        />
        <span
          className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground"
          style={{ left: pos(spot) }}
        >
          {t("forecastNow")}
        </span>
      </div>

      <dl className="num mt-3 grid grid-cols-3 gap-2 text-xs sm:text-sm">
        {(
          [
            ["forecastLow", lo],
            ["forecastMiddle", mid],
            ["forecastHigh", hi],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t(label)}
            </dt>
            <dd className="text-foreground">{price(v)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {t("forecastNow")}: <span className="num text-foreground">{price(spot)}</span> ·{" "}
          {t("forecastAsOf")} <span className="num">{forecast.asOf}</span>
        </span>
        {forecast.stale && (
          <span className="rounded-full border border-destructive/50 px-1.5 py-px text-destructive">
            {t("forecastStale")}
          </span>
        )}
        {state.source === "bundled" && (
          <span className="rounded-full border px-1.5 py-px">{t("forecastOffline")}</span>
        )}
      </div>
      {farFromClose && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>{t("spotFarFromClose")}</span>
          <button
            onClick={followMarketClose}
            className="rounded border px-2 py-0.5 text-foreground hover:border-primary hover:text-gold"
          >
            {t("useMarketClose")}
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">{t("forecastDisclaimer")}</p>
    </>,
  );
}
