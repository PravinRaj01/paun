import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGold } from "@/lib/gold-store";
import { analyze, baseRateOf, fmt, normPurity, PURITIES, sellQuote, type PurityId } from "@/lib/gold";
import { localToday } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

export function SellAnalyzer() {
  const { trade, setTrade, countries, settings } = useGold();
  const { t } = useI18n();
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;
  const money = (n: number) => fmt(n * base, cur, settings.decimals);
  const q = sellQuote(trade, settings.spotUsdOz);
  const usdIn = (v: string) => Math.max(0, Math.round((Number(v) / base) * 1e6) / 1e6);
  const shown = (n: number) => Math.round(n * base * 1e4) / 1e4;
  const diff = trade.askingPrice > 0 ? ((trade.askingPrice - q.payout) / (q.payout || 1)) * 100 : null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl">{t("sellTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("sellHint")}</p>
      </div>
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5">
        <div className="space-y-1.5">
          <Label>{t("weight")}</Label>
          <Input type="number" inputMode="decimal" min={0} step="0.01" className="num" value={trade.weight}
            onChange={(e) => setTrade((p) => ({ ...p, weight: Math.max(0, Number(e.target.value)) }))} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("purity")}</Label>
          <Select value={normPurity(trade.purity)} onValueChange={(v) => setTrade((p) => ({ ...p, purity: v as PurityId }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PURITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("deduction")}</Label>
          <Input type="number" inputMode="decimal" min={0} max={50} step="0.5" className="num" value={trade.deduction ?? 5}
            onChange={(e) => setTrade((p) => ({ ...p, deduction: Math.min(50, Math.max(0, Number(e.target.value))) }))} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("melting")} ({cur})</Label>
          <Input type="number" inputMode="decimal" min={0} step="0.01" className="num" value={shown(trade.melting)}
            onChange={(e) => setTrade((p) => ({ ...p, melting: usdIn(e.target.value) }))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("shopOffer")} ({cur})</Label>
          <Input type="number" inputMode="decimal" min={0} step="0.01" className="num" placeholder="0" value={shown(trade.askingPrice)}
            onChange={(e) => setTrade((p) => ({ ...p, askingPrice: usdIn(e.target.value) }))} />
        </div>
      </div>

      <div className={`rounded-lg border p-5 text-center ${diff === null ? "bg-card" : diff >= -2 ? "border-success/40 text-success" : diff >= -8 ? "border-primary/40 text-gold" : "border-destructive/40 text-destructive"}`}>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("estPayout")}</div>
        <div className="num font-display text-4xl">{money(q.payout)}</div>
        {diff !== null && (
          <p className="num mt-2 text-sm text-muted-foreground">
            {t("shopOffer")}: {money(trade.askingPrice)} ({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm">
        {[
          [`${q.pureGrams.toFixed(3)} g × spot`, q.metal],
          [`${t("deduction")}`, -q.deductionUsd],
          [t("melting"), -q.melting],
        ].map(([l, v]) => (
          <div key={l as string} className="flex justify-between py-1 text-muted-foreground">
            <span>{l}</span><span className="num">{money(v as number)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t pt-2 font-medium">
          <span>{t("estPayout")}</span><span className="num text-gold">{money(q.payout)}</span>
        </div>
      </div>
    </section>
  );
}

export function AddToVault() {
  const { trade, countries, settings, setVault } = useGold();
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const country = countries.find((c) => c.id === trade.countryId) ?? countries[0];
  if (!country || trade.weight <= 0) return null;
  const add = () => {
    const paid = trade.askingPrice > 0 ? trade.askingPrice : analyze(trade, country, settings.spotUsdOz, settings.priceBasis ?? "retail").totalUsd;
    setVault((v) => [...v, {
      id: crypto.randomUUID(), name: `${trade.weight} g ${normPurity(trade.purity)}`, weight: trade.weight,
      purity: normPurity(trade.purity), paidUsd: paid, date: localToday(),
    }]);
    setDone(true);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={add}>{t("addToVault")}</Button>
      {done && <Link to="/vault" className="text-sm text-gold hover:underline">{t("added")} →</Link>}
    </div>
  );
}
