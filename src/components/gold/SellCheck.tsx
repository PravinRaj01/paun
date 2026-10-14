import { ADDS_UP_TOLERANCE, sellCheck, SUSUT_STARTING_POINT_PCT, type SellForm } from "@/lib/gold";
import { useI18n } from "@/lib/i18n";
import { NumField, Row, Verdict } from "./check-ui";
import { useCheck } from "./use-check";

/** Selling or trading in: what the shop's own rate says it should pay, against what it offered. */
export function SellCheck() {
  const { usdPerOz, fx, curLabel, money, trade, setTrade } = useCheck();
  const { t } = useI18n();
  const s = trade.sell;
  const set = (patch: Partial<SellForm>) => setTrade((p) => ({ ...p, sell: { ...p.sell, ...patch } }));

  const r = sellCheck({
    weight: trade.weight,
    purity: trade.purity,
    buyBackRate: s.buyBackRate,
    sellRate: s.sellRate,
    susutPct: s.susutPct,
    offer: s.offer,
    tradeInRate: s.tradeInRate,
    fee: s.fee,
    usdPerOz,
    fxPerUsd: fx,
  });

  return (
    <section className="space-y-4">
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5">
        <NumField label={`${t("buyBackRate", { cur: curLabel })} · ${t("optional")}`} value={s.buyBackRate} onChange={(n) => set({ buyBackRate: n ?? 0 })} />
        <NumField label={`${t("shopOffer")} (${curLabel})`} value={s.offer} onChange={(n) => set({ offer: n ?? 0 })} />
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">{t("sellMore")}</summary>
          <p className="mt-3 text-xs text-muted-foreground">{t("orSusut")}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <NumField label={`${t("sellRateLabel", { cur: curLabel })} · ${t("optional")}`} value={s.sellRate} onChange={(n) => set({ sellRate: n ?? 0 })} />
            <NumField
              label={`${t("susutOfSell")} · ${t("optional")}`}
              value={s.susutPct}
              nullable
              step="0.5"
              placeholder={`e.g. ${SUSUT_STARTING_POINT_PCT}`}
              onChange={(n) => set({ susutPct: n })}
            />
            <NumField label={`${t("tradeInRate", { cur: curLabel })} · ${t("optional")}`} value={s.tradeInRate} onChange={(n) => set({ tradeInRate: n ?? 0 })} />
            <NumField label={`${t("testingFee", { cur: curLabel })} · ${t("optional")}`} value={s.fee} onChange={(n) => set({ fee: n ?? 0 })} />
          </div>
        </details>
      </div>

      {!r.ok ? (
        <Verdict tone="info">{r.error === "weight" ? t("enterWeight") : t("priceMissing")}</Verdict>
      ) : (
        <>
          <div className="rounded-lg border bg-card p-5 text-center">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("estPayout")}</div>
            <div className="num font-display text-4xl">{money(r.payout)}</div>
            <p className="mt-2 text-xs text-muted-foreground">
              {r.estimate.basis === "buyBack"
                ? t("basisBuyBack")
                : r.estimate.basis === "susut"
                  ? t("basisSusut", { pct: Number((r.estimate.susutPct ?? 0).toFixed(1)) })
                  : t("sellEstimateNote")}
            </p>
          </div>

          {r.offer && (
            <Verdict tone={r.offer.difference >= -ADDS_UP_TOLERANCE ? "good" : "warn"}>
              {Math.abs(r.offer.difference) <= ADDS_UP_TOLERANCE
                ? t("offerMatches")
                : r.offer.difference < 0
                  ? t("offerBelow", { amount: money(-r.offer.difference) })
                  : t("offerAbove", { amount: money(r.offer.difference) })}
              {r.offer.pct !== null && Math.abs(r.offer.difference) > ADDS_UP_TOLERANCE && (
                <span className="num mt-1 block text-xs text-muted-foreground">{`${r.offer.pct >= 0 ? "+" : ""}${r.offer.pct.toFixed(1)}%`}</span>
              )}
            </Verdict>
          )}

          <div className="rounded-lg border bg-card p-4 text-sm">
            <Row label={t("metalValueNow")} value={money(r.raw)} />
            {r.estimate.basis === "buyBack" && r.estimate.susutPct !== null && (
              <Row label={t("impliedSusut", { pct: Number(r.estimate.susutPct.toFixed(1)) })} value="" />
            )}
            {r.estimate.basis === "susut" && r.estimate.buyBackRate !== null && (
              <Row label={t("impliedBuyBack", { rate: money(r.estimate.buyBackRate) })} value="" />
            )}
            {r.tradeIn && <Row label={t("tradeInGain", { credit: money(r.tradeIn.credit), gain: money(r.tradeIn.gain) })} value="" />}
            <p className="mt-2 text-xs text-muted-foreground">{t("upahNotReturned")}</p>
          </div>
        </>
      )}
    </section>
  );
}
