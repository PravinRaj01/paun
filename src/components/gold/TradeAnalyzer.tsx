import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGold } from "@/lib/gold-store";
import { analyze, baseRateOf, BASIS_LABEL, cheapestOf, fmt, normPurity, premiumOf, PURITIES, purityLabel, verdictOf, type PurityId, type VerdictTone } from "@/lib/gold";
import { BasisBadge } from "./BasisBadge";
import { useI18n } from "@/lib/i18n";
import { SellAnalyzer, AddToVault } from "./SellAnalyzer";

export function TradeAnalyzer() {
  const { trade, setTrade } = useGold();
  const { t } = useI18n();
  const side = trade.side ?? "buy";
  return (
    <div className="space-y-4">
      <div className="inline-grid grid-cols-2 rounded-full border bg-card p-0.5 text-sm">
        {(["buy", "sell"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTrade((p) => ({ ...p, side: k }))}
            className={`rounded-full px-4 py-1.5 ${side === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {t(k)}
          </button>
        ))}
      </div>
      {side === "sell" ? <SellAnalyzer /> : <><BuyAnalyzer /><AddToVault /></>}
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? "border-primary/40 bg-gold-soft" : "bg-card"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`num mt-1 text-2xl ${accent ? "text-gold" : ""}`}>{value}</div>
      {sub && <div className="num mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const TONE: Record<VerdictTone, string> = {
  good: "border-success/40 text-success",
  fair: "border-primary/40 text-gold",
  pricey: "border-primary/40 text-gold",
  expensive: "border-destructive/40 text-destructive",
};

function BuyAnalyzer() {
  const { trade, setTrade, countries, settings } = useGold();
  const { language, t } = useI18n();
  const country = countries.find((c) => c.id === trade.countryId) ?? countries[0];
  const d = settings.decimals;
  const baseCur = settings.baseCurrency;
  const base = baseRateOf(settings, countries);
  const set = <K extends keyof typeof trade>(k: K, v: (typeof trade)[K]) => setTrade((t) => ({ ...t, [k]: v }));

  // Fee / melting / asking price are entered in the display currency, stored in USD.
  const numBase = (k: "fee" | "melting" | "askingPrice") => ({
    type: "number",
    min: 0,
    step: "0.01",
    className: "num",
    value: Math.round(trade[k] * base * 1e4) / 1e4,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(k, Math.max(0, Math.round((Number(e.target.value) / base) * 1e6) / 1e6)),
  });
  const numWeight = {
    type: "number",
    min: 0,
    step: "0.01",
    className: "num",
    value: trade.weight,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set("weight", Math.max(0, Number(e.target.value))),
  };

  const money = (n: number, c = baseCur, rate = base) => fmt(n * rate, c, d);

  if (!country) return <p className="text-sm text-muted-foreground">Add a country to analyze a trade.</p>;
  const basis = settings.priceBasis ?? "retail";
  const purity = normPurity(trade.purity);
  const r = analyze(trade, country, settings.spotUsdOz, basis);

  if (settings.mode === "simple") {
    const v = verdictOf(trade.askingPrice, r.totalUsd);
    const cheap = cheapestOf(countries, trade, settings.spotUsdOz, basis);
    return (
      <section className="space-y-4">
        <div>
           <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-2xl">{t("checkPrice")}</h2><BasisBadge /></div>
           <p className="text-sm text-muted-foreground">{t("checkPriceHint")}</p>
        </div>
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5">
          <div className="space-y-1.5">
             <Label>{t("weight")}</Label>
            <Input {...numWeight} />
          </div>
          <div className="space-y-1.5">
             <Label>{t("purity")}</Label>
            <Select value={purity} onValueChange={(val) => set("purity", val as PurityId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PURITIES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
             <Label>{t("buyingIn")}</Label>
            <Select value={country.id} onValueChange={(val) => set("countryId", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {countries.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
             <Label>{t("askingPrice")} ({baseCur})</Label>
            <Input {...numBase("askingPrice")} placeholder="0" />
          </div>
        </div>

        <div className={`rounded-lg border p-5 text-center sm:p-6 ${v ? TONE[v.tone] : "bg-card"}`}>
          {v ? (
            <>
              <div className="font-display text-4xl">{v.label}</div>
              <p className="num mt-2 text-sm text-muted-foreground">
                You're paying about {Math.abs(v.pct).toFixed(1)}% {v.pct > 0 ? "above" : "below"} what this gold is worth.
              </p>
            </>
          ) : (
            <>
              <div className="font-display text-4xl">{money(r.totalUsd)}</div>
               <p className="mt-2 text-sm text-muted-foreground">
                 {language === "ms"
                   ? `Anggaran kos penuh untuk ${trade.weight} g emas ${purityLabel(purity)} di ${country.name}. Masukkan harga penjual untuk menyemak nilainya.`
                   : `Estimated all-in cost for ${trade.weight} g of ${purityLabel(purity)} gold in ${country.name}. Enter the seller's asking price to see if it's a good deal.`}
               </p>
            </>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
             <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("allInPerGram")}</div>
            <div className="num mt-1 text-xl">
              {fmt(r.breakEvenPerG * country.rate, country.currency, d)}
              <span className="text-sm text-muted-foreground"> / g in {country.currency}</span>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
             <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("cheapestList")}</div>
            <div className="num mt-1 text-xl">
              {cheap ? cheap.c.name : "—"}
              {cheap && <span className="num text-sm text-muted-foreground"> · {money(cheap.r.totalUsd)}</span>}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
         <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-2xl">{t("tradeAnalyzer")}</h2><BasisBadge /></div>
        <p className="text-sm text-muted-foreground">
          Fees in {baseCur}. Priced for {country.name} on {BASIS_LABEL[basis].toLowerCase()} basis.
        </p>
      </div>
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        <div className="space-y-1.5">
           <Label>{t("weight")}</Label>
          <Input {...numWeight} />
        </div>
        <div className="space-y-1.5">
           <Label>{t("purity")}</Label>
          <Select value={purity} onValueChange={(v) => set("purity", v as PurityId)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PURITIES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} · {(p.fineness / 10).toFixed(1)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
           <Label>{t("pricedIn")}</Label>
          <Select value={country.id} onValueChange={(v) => set("countryId", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {countries.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
             <Label>{t("makingFee")} ({baseCur})</Label>
            <div className="flex rounded-md border p-0.5 text-xs">
              {(["perGram", "flat"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => set("feeMode", m)}
                  className={`rounded px-2 py-0.5 ${trade.feeMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                   {m === "perGram" ? t("perGram") : t("flat")}
                </button>
              ))}
            </div>
          </div>
          <Input {...numBase("fee")} />
        </div>
        <div className="space-y-1.5">
           <Label>{t("sellerAsking")} ({baseCur})</Label>
          <Input {...numBase("askingPrice")} placeholder="0" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
         <Metric label={t("netGold")} value={money(r.netGold)} sub={`${r.pureGrams.toFixed(3)} g`} />
         <Metric label={t("totalAcquisition")} value={money(r.totalUsd)} sub={fmt(r.totalLocal, country.currency, d)} />
        <Metric
           label={t("jewelerPremium")}
          value={`${r.premiumPct.toFixed(2)}%`}
          sub={r.askingPremium !== null ? `Asking price: ${r.askingPremium.toFixed(2)}% over spot` : "over global spot"}
          accent
        />
        <Metric
           label={t("breakEven")}
          value={`${money(r.breakEvenPerG)}/g`}
          sub={`${money(r.breakEvenPerPureG)}/g pure`}
        />
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm">
        {[
          ["Pure gold at spot", r.netGold],
          ...(basis === "retail" ? [[`Shop mark-up (${premiumOf(country)}%)`, r.shopMarkup]] : []),
          ["Making fee", r.makingFee],
          [`Import duty (${country.duty}%)`, r.duties],
          [`Tax / VAT (${country.tax}%)`, r.taxes],
        ].map(([l, v]) => (
          <div key={l as string} className="flex justify-between py-1 text-muted-foreground">
            <span>{l}</span>
            <span className="num">{money(v as number)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t pt-2 font-medium">
          <span>Total</span>
          <span className="num text-gold">{money(r.totalUsd)}</span>
        </div>
        {trade.askingPrice > 0 && (
          <p className={`mt-3 text-xs ${trade.askingPrice > r.totalUsd ? "text-destructive" : "text-success"}`}>
            Asking price is {money(Math.abs(trade.askingPrice - r.totalUsd))}{" "}
            {trade.askingPrice > r.totalUsd ? "above" : "below"} your computed fair cost.
          </p>
        )}
      </div>
    </section>
  );
}
