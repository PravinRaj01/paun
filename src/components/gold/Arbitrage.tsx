import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownUp, Pencil, TrendingDown, TrendingUp, X } from "lucide-react";
import { useGold } from "@/lib/gold-store";
import { analyze, baseRateOf, fmt, purityLabel } from "@/lib/gold";
import { BasisBadge } from "./BasisBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

type SortKey = "name" | "total" | "perG" | "premium";

export function Arbitrage() {
  const { countries, trade, settings, excluded, setExcluded } = useGold();
  const { t } = useI18n();
  const [sort, setSort] = useState<SortKey>("total");
  const [asc, setAsc] = useState(true);
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);
  const d = settings.decimals;
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;

  const included = countries.filter((c) => !excluded.includes(c.id));
  const rows = included.map((c) => ({ c, r: analyze(trade, c, settings.spotUsdOz, settings.priceBasis ?? "retail") }));
  const money = (n: number) => fmt(n * base, cur, d);

  const toggle = (id: string) =>
    setExcluded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const pick = (slot: "a" | "b", id: string) =>
    setPair((p) => ({ a: slot === "a" ? id : (p?.a ?? included[0]?.id ?? id), b: slot === "b" ? id : (p?.b ?? included[1]?.id ?? included[0]?.id ?? id) }));
  const aId = pair && included.some((c) => c.id === pair.a) ? pair.a : included[0]?.id;
  const bId = pair && included.some((c) => c.id === pair.b) ? pair.b : (included[1] ?? included[0])?.id;
  const A = included.find((c) => c.id === aId);
  const B = included.find((c) => c.id === bId);
  const rA = A ? analyze(trade, A, settings.spotUsdOz, settings.priceBasis ?? "retail") : null;
  const rB = B ? analyze(trade, B, settings.spotUsdOz, settings.priceBasis ?? "retail") : null;

  if (countries.length === 0) return null;

  const min = rows.length ? Math.min(...rows.map((x) => x.r.totalUsd)) : 0;
  const max = rows.length ? Math.max(...rows.map((x) => x.r.totalUsd)) : 0;
  const best = rows.find((x) => x.r.totalUsd === min);
  const sell = rows.find((x) => x.r.totalUsd === max);

  const val = (x: (typeof rows)[number]) =>
    sort === "name" ? x.c.name : sort === "total" ? x.r.totalUsd : sort === "perG" ? x.r.breakEvenPerG : x.r.premiumPct;
  const sorted = [...rows].sort((a, b) => {
    const va = val(a), vb = val(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return asc ? cmp : -cmp;
  });

  const H = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`px-4 py-2 font-normal ${right ? "text-right" : "text-left"}`}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => (sort === k ? setAsc(!asc) : (setSort(k), setAsc(true)))}
      >
        {label}
        <ArrowDownUp className={`h-3 w-3 ${sort === k ? "text-gold" : "opacity-40"}`} />
      </button>
    </th>
  );

  const compareRow = (label: string, va: number, vb: number, text: (n: number) => string, lowerWins = true) => {
    const aWins = lowerWins ? va < vb : va > vb;
    const bWins = lowerWins ? vb < va : vb > va;
    return (
      <div key={label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2">
        <span className={`num text-right text-sm ${aWins ? "font-medium text-success" : "text-muted-foreground"}`}>{text(va)}</span>
        <span className="px-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`num text-sm ${bWins ? "font-medium text-success" : "text-muted-foreground"}`}>{text(vb)}</span>
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div>
         <h2 className="font-display text-2xl">{t("spreadTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          This trade ({trade.weight} g {purityLabel(trade.purity)}, <BasisBadge inline />) priced across the selected countries.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
         <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("activeTrade")}</span>
        {[
           [t("weight"), `${trade.weight} g`],
           [t("purity"), purityLabel(trade.purity)],
           [t("makingFee"), `${money(trade.fee)}${trade.feeMode === "perGram" ? " / g" : ` ${t("flat")}`}`],
        ].map(([l, v]) => (
          <span key={l}><span className="text-muted-foreground">{l} </span><span className="num">{v}</span></span>
        ))}
        <Link to="/dashboard" className="ml-auto inline-flex items-center gap-1 text-xs text-gold hover:underline">
           <Pencil className="h-3 w-3" /> {t("editCalculator")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {countries.map((c) => {
          const on = !excluded.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                on ? "border-primary/50 bg-gold-soft" : "border-dashed text-muted-foreground opacity-60 hover:opacity-100"
              }`}
            >
              {c.name}
              {on && <X className="h-3 w-3 opacity-50" />}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Select at least one country above to compare.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="min-w-0 rounded-lg border border-success/40 bg-card p-2.5 sm:p-4">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-success sm:gap-2 sm:text-xs">
                 <TrendingDown className="h-3.5 w-3.5" /> <span className="truncate">{t("buyHere")}</span>
              </div>
              <div className="mt-1 truncate text-sm font-medium sm:text-lg">{best!.c.name}</div>
              <div className="num text-sm text-muted-foreground">{money(best!.r.totalUsd)}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-primary/40 bg-card p-2.5 sm:p-4">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gold sm:gap-2 sm:text-xs">
                 <TrendingUp className="h-3.5 w-3.5" /> <span className="truncate">{t("sellHere")}</span>
              </div>
              <div className="mt-1 truncate text-sm font-medium sm:text-lg">{sell!.c.name}</div>
              <div className="num text-sm text-muted-foreground">{money(sell!.r.totalUsd)}</div>
            </div>
            <div className="min-w-0 rounded-lg border bg-card p-2.5 sm:p-4">
               <div className="text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">{t("spread")}</div>
              <div className="num mt-1 text-sm sm:text-lg">{money(max - min)}</div>
              <div className="num text-sm text-muted-foreground">
                {min > 0 ? (((max - min) / min) * 100).toFixed(2) : "0"}%
              </div>
            </div>
          </div>

          {A && B && rA && rB && (
            <div className="rounded-lg border bg-card p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <Select value={aId ?? ""} onValueChange={(v) => pick("a", v)}>
                  <SelectTrigger className="h-8 w-full min-w-0 justify-end border-0 bg-muted text-sm font-medium shadow-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{included.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">vs</span>
                <Select value={bId ?? ""} onValueChange={(v) => pick("b", v)}>
                  <SelectTrigger className="h-8 w-full min-w-0 border-0 bg-muted text-sm font-medium shadow-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{included.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="mt-2 divide-y border-t">
                {compareRow("Total", rA.totalUsd, rB.totalUsd, money)}
                {compareRow("Per gram", rA.breakEvenPerG, rB.breakEvenPerG, money)}
                {compareRow("Premium", rA.premiumPct, rB.premiumPct, (n) => `${n.toFixed(2)}%`)}
              </div>
            </div>
          )}

          <ul className="divide-y rounded-lg border bg-card sm:hidden">
            {sorted.map(({ c, r }) => (
              <li key={c.id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${r.totalUsd === min ? "bg-success/5" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="num truncate text-xs text-muted-foreground">
                    {money(r.breakEvenPerG)}/g · {r.premiumPct.toFixed(1)}% · {fmt(r.totalLocal, c.currency, 0)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-sm">{money(r.totalUsd)}</div>
                  <div className={`num text-xs ${r.totalUsd === min ? "text-success" : "text-muted-foreground"}`}>
                    {r.totalUsd === min ? "Cheapest" : `+${money(r.totalUsd - min)}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border bg-card sm:block">
            <table className="w-full text-sm">
              <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <H k="name" label="Country" />
                  <H k="total" label={`Total (${cur})`} right />
                  <th className="px-4 py-2 text-right font-normal">Local</th>
                  <H k="perG" label="Per gram" right />
                  <H k="premium" label="Premium" right />
                  <th className="px-4 py-2 text-right font-normal">vs. cheapest</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ c, r }) => (
                  <tr key={c.id} className={`border-b last:border-0 ${r.totalUsd === min ? "bg-success/5" : ""}`}>
                    <td className="px-4 py-2.5">{c.name}</td>
                    <td className="num px-4 py-2.5 text-right">{money(r.totalUsd)}</td>
                    <td className="num px-4 py-2.5 text-right text-muted-foreground">{fmt(r.totalLocal, c.currency, d)}</td>
                    <td className="num px-4 py-2.5 text-right">{money(r.breakEvenPerG)}</td>
                    <td className="num px-4 py-2.5 text-right">{r.premiumPct.toFixed(2)}%</td>
                    <td className={`num px-4 py-2.5 text-right ${r.totalUsd === min ? "text-success" : "text-muted-foreground"}`}>
                      {r.totalUsd === min ? "Cheapest" : `+${money(r.totalUsd - min)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
