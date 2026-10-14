import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { buyCheck, fmt, metalPerGram, SUSUT_STARTING_POINT_PCT, type BuyForm, type UpahMode } from "@/lib/gold";
import { useGold } from "@/lib/gold-store";
import { localToday } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { GuideLink, NumField, Row, Verdict } from "./check-ui";
import { useCheck } from "./use-check";

/** At the counter: does the shop's total add up, what is gold and what is workmanship, and what would you get back. */
export function BuyCheck() {
  const { usdPerOz, fx, cur, curLabel, hydrated, money, decimals, trade, setTrade } = useCheck();
  const { setVault } = useGold();
  const { t } = useI18n();
  const [added, setAdded] = useState(false);
  const b = trade.buy;
  const set = (patch: Partial<BuyForm>) => setTrade((p) => ({ ...p, buy: { ...p.buy, ...patch } }));
  const metal = metalPerGram(trade.purity, usdPerOz, fx);

  const r = buyCheck({
    weight: trade.weight,
    purity: trade.purity,
    shopRate: b.shopRate,
    upah: b.upah,
    upahMode: b.upahMode,
    quotedTotal: b.quotedTotal,
    buyBackRate: b.buyBackRate,
    susutPct: b.susutPct,
    usdPerOz,
    fxPerUsd: fx,
  });

  const addToVault = () => {
    if (!r.ok) return;
    const paid = r.quote?.total ?? r.expectedTotal; // the typed total, otherwise the total the typed rate and upah give: never Paun's own guess
    setVault((v) => [
      ...v,
      {
        id: crypto.randomUUID(),
        name: `${trade.weight} g ${trade.purity}`,
        weight: trade.weight,
        purity: trade.purity,
        paidUsd: paid / fx,
        paid,
        currency: cur,
        date: localToday(),
      },
    ]);
    setAdded(true);
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5">
        <NumField label={t("shopRate", { cur: curLabel })} value={b.shopRate} onChange={(n) => set({ shopRate: n ?? 0 })} />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium leading-none">{t("upahLabel", { cur: curLabel })}</span>
            <div className="flex rounded-md border p-0.5 text-xs">
              {(["flat", "perGram"] as const).map((m: UpahMode) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set({ upahMode: m })}
                  className={`rounded px-2 py-0.5 ${b.upahMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {m === "perGram" ? t("perGram") : t("perPiece")}
                </button>
              ))}
            </div>
          </div>
          <NumField label="" value={b.upah} onChange={(n) => set({ upah: n ?? 0 })} />
        </div>
        <div className="sm:col-span-2">
          <NumField label={`${t("quotedTotal", { cur: curLabel })} · ${t("optional")}`} value={b.quotedTotal} onChange={(n) => set({ quotedTotal: n ?? 0 })} />
        </div>
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">{t("soldBackHere")}</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <NumField label={t("buyBackRate", { cur: curLabel })} value={b.buyBackRate} onChange={(n) => set({ buyBackRate: n ?? 0 })} />
            <NumField label={t("susutOfSell")} value={b.susutPct} nullable step="0.5" placeholder={`e.g. ${SUSUT_STARTING_POINT_PCT}`} onChange={(n) => set({ susutPct: n })} />
          </div>
        </details>
      </div>

      {hydrated && <p className="num text-xs text-muted-foreground">{t("metalValueToday", { value: money(metal), purity: trade.purity })}</p>}

      {!r.ok ? (
        <Verdict tone="info">
          {r.error === "weight" ? t("enterWeight") : r.error === "price" ? t("priceMissing") : t("enterShopRate")}
        </Verdict>
      ) : (
        <>
          {r.quote && (
            <Verdict tone={r.quote.addsUp ? "good" : "warn"}>
              {r.quote.addsUp
                ? t("addsUp")
                : r.quote.difference > 0
                  ? t("quoteMore", { amount: money(r.quote.difference) })
                  : t("quoteLess", { amount: money(-r.quote.difference) })}
              {!r.quote.addsUp && b.upah === 0 && (
                <span className="num mt-1 block text-xs text-muted-foreground">{t("realRate", { rate: money(r.quote.realRatePerGram) })}</span>
              )}
            </Verdict>
          )}

          <div className="rounded-lg border bg-card p-4 text-sm">
            <Row label={t("goldPart", { weight: trade.weight, rate: money(b.shopRate) })} value={money(r.goldPart)} />
            <Row label={t("upahPart")} value={money(r.upahPart)} />
            <Row strong label={t("expectedTotal")} value={money(r.expectedTotal)} />
            <div className="mt-3 border-t pt-2">
              <Row label={t("shopMargin")} value={`${money(r.shopMargin)} (${r.shopMarginPct.toFixed(1)}%)`} />
              <Row label={t("overMetal")} value={money(r.paidOverRaw)} />
              <Row label={t("upahShare")} value={`${(r.upahShare * 100).toFixed(1)}%`} />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 text-sm">
            <Row
              strong
              label={`${t("soldBackToday")} · ${
                r.sellBack.basis === "buyBack"
                  ? t("basisBuyBack")
                  : r.sellBack.basis === "susut"
                    ? t("basisSusut", { pct: Number((r.sellBack.susutPct ?? 0).toFixed(1)) })
                    : t("basisEstimate")
              }`}
              value={money(r.sellBack.payout)}
            />
            <p className="num mt-2 text-xs text-muted-foreground">{t("roundTrip", { amount: money(r.roundTripLoss) })}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={addToVault}>
              {t("addToVault")} · {fmt(r.quote?.total ?? r.expectedTotal, cur, decimals)}
            </Button>
            {added && <Link to="/vault" className="text-sm text-gold hover:underline">{t("added")} →</Link>}
          </div>
        </>
      )}
      <div><GuideLink topic="upah" label={t("guideLinkUpah")} /></div>
    </section>
  );
}
