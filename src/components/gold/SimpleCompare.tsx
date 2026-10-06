import { useGold } from "@/lib/gold-store";
import { analyze, baseRateOf, fmt, purityLabel, normPurity } from "@/lib/gold";
import { BasisBadge } from "./BasisBadge";
import { useI18n } from "@/lib/i18n";

/** Plain-language "where is it cheapest" ranking for Simple mode. */
export function SimpleCompare({ title }: { title?: string }) {
  const { countries, trade, settings } = useGold();
  const { language } = useI18n();
  const base = baseRateOf(settings, countries);
  const basis = settings.priceBasis ?? "retail";
  const rows = countries
    .map((c) => ({ c, total: analyze(trade, c, settings.spotUsdOz, basis).totalUsd }))
    .sort((a, b) => a.total - b.total);
  const min = rows[0]?.total ?? 0;
  const max = rows[rows.length - 1]?.total ?? 1;
  return (
    <section className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-2xl">{title ?? (language === "ms" ? "Di mana emas paling murah?" : "Where is gold cheapest?")}</h2><BasisBadge /></div>
        <p className="text-sm text-muted-foreground">
           {language === "ms" ? `Harga untuk ${trade.weight} g emas ${purityLabel(normPurity(trade.purity))}, termasuk cukai. Ubah butiran di halaman Kalkulator.` : `Price for ${trade.weight} g of ${purityLabel(normPurity(trade.purity))} gold, including taxes. Change the gold on the Calculator page.`}
        </p>
      </div>
      <ol className="space-y-2">
        {rows.map(({ c, total }, i) => (
          <li key={c.id} className={`rounded-xl border p-4 ${i === 0 ? "border-success/50 bg-success/5" : "bg-card"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{i + 1}. {c.name}</div>
                <div className="text-xs text-muted-foreground">
                   {i === 0 ? (language === "ms" ? "Termurah dalam senarai" : "Cheapest on your list") : language === "ms" ? `${fmt((total - min) * base, settings.baseCurrency, 0)} lebih mahal daripada ${rows[0]?.c.name}` : `${fmt((total - min) * base, settings.baseCurrency, 0)} more than ${rows[0]?.c.name}`}
                </div>
              </div>
              <div className="num shrink-0 text-lg text-gold">{fmt(total * base, settings.baseCurrency, 0)}</div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${i === 0 ? "bg-success" : "bg-primary/70"}`}
                style={{ width: `${max > min ? 30 + ((total - min) / (max - min)) * 70 : 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
       {!rows.length && <p className="text-sm text-muted-foreground">{language === "ms" ? "Tambah negara dalam mod Pro untuk membanding." : "Add countries in Pro mode to compare."}</p>}
    </section>
  );
}
