import { useEffect, useState } from "react";
import { ChevronDown, List } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/gold/AppShell";
import { Watchlist } from "@/components/gold/Watchlist";
import { SpotChart } from "@/components/gold/SpotChart";
import { ForecastCard } from "@/components/gold/ForecastCard";
import { BasisBadge } from "@/components/gold/BasisBadge";
import { SimpleCompare } from "@/components/gold/SimpleCompare";
import { useGold } from "@/lib/gold-store";
import { baseRateOf, fmt, fineOf, GRAMS_PER_OUNCE, premiumOf, PURITIES, type PurityId } from "@/lib/gold";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Gold Markets & Watchlist — Paun" },
      { name: "description", content: "Gold spot chart (1D–1Y) and per-gram cost by country, raw or shop price, 999 to 417." },
      { property: "og:title", content: "Gold Markets & Watchlist — Paun" },
      { property: "og:description", content: "Gold spot chart (1D–1Y) and per-gram cost by country, raw or shop price, 999 to 417." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Markets,
});

function Markets() {
  const { countries, settings } = useGold();
  const { t } = useI18n();
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;
  const basis = settings.priceBasis ?? "retail";
  const [purity, setPurity] = useState<PurityId>("916");
  const [ready, setReady] = useState(false);
  const [showList, setShowList] = useState(true);
  useEffect(() => setReady(true), []);
  const g = (settings.spotUsdOz / GRAMS_PER_OUNCE) * fineOf(purity) * base;
  const r2 = (n: number) => Number(n.toFixed(2));
  const data = countries
    .map((c) => {
      const mark = g * (premiumOf(c, basis) / 100);
      const pre = g + mark;
      const taxes = pre * (1 + c.duty / 100) * (1 + c.tax / 100) - pre;
      return { name: c.name, currency: c.currency, rate: c.rate, metal: r2(g), shop: r2(mark), taxes: r2(taxes), total: r2(pre + taxes) };
    })
    .sort((a, b) => a.total - b.total);
  const tt = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" };
  return (
    <AppShell>
      <div className="space-y-8 sm:space-y-10">
        {settings.mode === "pro" && (
          <div className="flex justify-end">
            <button onClick={() => setShowList((v) => !v)} aria-expanded={showList}
              className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-gold">
               <List className="h-3.5 w-3.5" /> {t("countryWatchlist")} · {countries.length}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showList ? "rotate-180" : ""}`} />
            </button>
          </div>
        )}
        <div className={`grid gap-8 ${settings.mode === "pro" && showList ? "lg:grid-cols-[1fr_360px]" : ""}`}>
          <div className="min-w-0 space-y-8 sm:space-y-10">
            {ready ? <SpotChart /> : <div className="h-[430px] rounded-lg border bg-card" />}
            {ready ? <ForecastCard /> : <div className="h-64 rounded-lg border bg-card" />}
            {settings.mode === "pro" && (
              <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                   <h2 className="font-display text-xl sm:text-2xl">{t("costCountry")}</h2>
                   <p className="text-sm text-muted-foreground">{cur} · {t("costHint")}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {PURITIES.filter((p) => ["999.9", "999", "916", "750", "585"].includes(p.id)).map((p) => (
                    <button key={p.id} onClick={() => setPurity(p.id)}
                      className={`num rounded-full border px-2.5 py-0.5 text-xs ${purity === p.id ? "border-primary bg-primary/10 text-gold" : "text-muted-foreground"}`}>
                      {p.id}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-96 rounded-lg border bg-card p-2 sm:p-4">
                {!ready ? null : data.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" domain={[() => Math.floor(g * 0.9), "auto"]} allowDataOverflow tickFormatter={(v) => fmt(v, cur, 0)} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={82} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                      <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tt}
                        formatter={(v: number, n: string, it: { payload?: { currency: string; rate: number } }) => {
                          const p = it?.payload;
                          const main = fmt(v, cur, settings.decimals);
                          return [p && p.currency !== cur ? `${main} (${fmt((v / base) * p.rate, p.currency, settings.decimals)})` : main, n];
                        }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="metal" name={`Raw ${purity} metal`} stackId="a" fill="var(--primary)" />
                      {basis === "retail" && <Bar dataKey="shop" name="Shop mark-up" stackId="a" fill="var(--shop-markup)" />}
                      <Bar dataKey="taxes" name="Duty & tax" stackId="a" fill="var(--destructive)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="p-6 text-center text-sm text-muted-foreground">Add countries to see the chart.</p>
                )}
              </div>
            </section>
            )}
          </div>
          <AnimatePresence initial={false}>
            {settings.mode === "pro" && showList && (
              <motion.div key="wl" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="min-w-0 lg:order-none">
                <Watchlist />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {settings.mode === "simple" && <div className="mx-auto max-w-2xl"><SimpleCompare title={t("costCountry")} /></div>}
      </div>
    </AppShell>
  );
}
