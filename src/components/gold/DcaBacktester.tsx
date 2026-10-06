import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { backtestDca, type DcaContribution, type DcaResult } from "@/lib/dca";
import { useSnapshot } from "@/lib/forecast/snapshot";
import { baseRateOf, fmt, PURITIES, type PurityId } from "@/lib/gold";
import { useGold } from "@/lib/gold-store";
import { useI18n, type CopyKey } from "@/lib/i18n";

const PERIODS: { months: number; label: CopyKey }[] = [
  { months: 12, label: "dcaYear1" },
  { months: 36, label: "dcaYear3" },
  { months: 60, label: "dcaYear5" },
];

/**
 * "What if I'd bought gold every month?" - replays real daily prices from the published snapshot (src/lib/dca.ts holds the
 * maths and its tests). This component only gathers the inputs and shows the result.
 */
export function DcaBacktester() {
  const { settings, countries, trade } = useGold();
  const { t } = useI18n();
  const snap = useSnapshot();
  const cur = settings.baseCurrency;
  const basis = settings.priceBasis ?? "retail";

  const [mode, setMode] = useState<DcaContribution["mode"]>("grams");
  const [grams, setGrams] = useState("1");
  const [amount, setAmount] = useState("500");
  const [months, setMonths] = useState(36);
  const [purity, setPurity] = useState<PurityId>("916");
  const [countryId, setCountryId] = useState("");
  const [rate, setRate] = useState("3");

  const country =
    countries.find((c) => c.id === countryId) ??
    countries.find((c) => c.currency === cur) ??
    countries[0];
  const money = (n: number) => fmt(n, cur, settings.decimals);

  const result = useMemo(() => {
    if (snap.status !== "ready" || !country) return null;
    const h = snap.snapshot.longHistory;
    const value = Number(mode === "grams" ? grams : amount);
    return backtestDca(
      { dates: h.dates, xau: h.xau, usdmyr: h.usdmyr },
      {
        months,
        contribution: mode === "grams" ? { mode, grams: value } : { mode, amount: value },
        purity,
        country,
        basis,
        savingsRatePct: rate.trim() === "" ? Number.NaN : Number(rate),
        baseCurrency: cur,
        baseRateToday: baseRateOf(settings, countries),
        deductionPct: trade.deduction ?? 5,
      },
    );
  }, [
    snap,
    country,
    mode,
    grams,
    amount,
    months,
    purity,
    basis,
    rate,
    cur,
    settings,
    countries,
    trade.deduction,
  ]);

  const seg = (on: boolean) =>
    `flex-1 whitespace-nowrap rounded px-3 py-1.5 text-sm ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;
  const tone = (n: number) => (n >= 0 ? "text-success" : "text-destructive");

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="font-display text-2xl">{t("dcaTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("dcaHint")}</p>
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex rounded-md border p-0.5" role="group">
            {(["grams", "amount"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={seg(mode === m)}
              >
                {t(m === "grams" ? "dcaModeGrams" : "dcaModeAmount")}
              </button>
            ))}
          </div>
          <Label>{mode === "grams" ? t("dcaGramsLabel") : `${t("dcaAmountLabel")} (${cur})`}</Label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            className="num"
            value={mode === "grams" ? grams : amount}
            onChange={(e) =>
              mode === "grams" ? setGrams(e.target.value) : setAmount(e.target.value)
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("dcaPeriod")}</Label>
          <div className="flex rounded-md border p-0.5" role="group">
            {PERIODS.map((p) => (
              <button
                key={p.months}
                type="button"
                aria-pressed={months === p.months}
                onClick={() => setMonths(p.months)}
                className={seg(months === p.months)}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("purity")}</Label>
          <Select value={purity} onValueChange={(v) => setPurity(v as PurityId)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PURITIES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("country")}</Label>
          <Select value={country?.id ?? ""} onValueChange={setCountryId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {countries.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("dcaSavingsRate")}</Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            className="num sm:max-w-40"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("dcaSavingsHint")}</p>
        </div>
      </section>

      {snap.status === "loading" && (
        <div
          className="h-40 animate-pulse rounded-lg border bg-muted/40"
          role="status"
          aria-label={t("dcaLoading")}
        />
      )}
      {snap.status === "error" && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("dcaUnavailable")}
        </p>
      )}
      {result && !result.ok && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t(
            result.error === "invalidContribution"
              ? "dcaInvalidAmount"
              : result.error === "invalidRate"
                ? "dcaInvalidRate"
                : "dcaNoData",
          )}
        </p>
      )}
      {result?.ok && (
        <Results
          r={result}
          money={money}
          tone={tone}
          basisIsShop={basis === "retail"}
          countryName={country?.name ?? ""}
          perMonth={mode === "grams" ? `${grams} g` : money(Number(amount))}
        />
      )}
    </div>
  );
}

function Results({
  r,
  money,
  tone,
  basisIsShop,
  countryName,
  perMonth,
}: {
  r: DcaResult;
  money: (n: number) => string;
  tone: (n: number) => string;
  basisIsShop: boolean;
  countryName: string;
  perMonth: string;
}) {
  const { t } = useI18n();
  const goldNow = r.valueSellBackBase;
  const profit = r.profitSellBackBase;
  const gap = r.goldVsSavingsBase;
  const data = r.series.map((s) => ({
    t: Date.parse(`${s.date}T00:00:00Z`),
    cash: +s.invested.toFixed(2),
    gold: +s.goldValue.toFixed(2),
    savings: +s.savings.toFixed(2),
  }));
  const tile = (label: string, value: string, extra?: { sub?: string; cls?: string }) => (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`num mt-1 text-xl ${extra?.cls ?? ""}`}>{value}</div>
      {extra?.sub && <div className="num text-xs text-muted-foreground">{extra.sub}</div>}
    </div>
  );
  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
  };

  return (
    <>
      <p className={`rounded-lg border bg-card p-4 text-base ${tone(gap)}`}>
        {gap >= 0
          ? t("dcaAheadGold", { amount: money(gap) })
          : t("dcaAheadSavings", { amount: money(-gap) })}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile(t("dcaGramsSaved"), `${r.totalGrams.toFixed(2)} g`, {
          sub: `${r.purchaseCount} × ${perMonth}`,
        })}
        {tile(t("dcaCashIn"), money(r.investedBase), {
          sub: `${t("dcaAvgCost")}: ${money(r.avgCostPerGramBase)}`,
        })}
        {tile(t(basisIsShop ? "dcaGoldNowSell" : "dcaGoldNowSpot"), money(goldNow), {
          sub: `${profit >= 0 ? "+" : ""}${money(profit)}`,
          cls: tone(profit),
        })}
        {tile(t("dcaSavingsBalance"), money(r.savingsBase), {
          sub: `${r.savingsBase - r.investedBase >= 0 ? "+" : ""}${money(r.savingsBase - r.investedBase)}`,
        })}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">{t("dcaChartTitle")}</h3>
        <div className="mt-3 h-64 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                minTickGap={40}
                tickFormatter={(v: number) =>
                  new Date(v).toLocaleDateString([], { month: "short", year: "2-digit" })
                }
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                orientation="right"
                width={72}
                tickFormatter={(v: number) => money(v).replace(/\.\d+$/, "")}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v: number) => new Date(v).toLocaleDateString()}
                formatter={(v: number, name: string) => [money(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="cash"
                name={t("dcaSeriesCash")}
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="savings"
                name={t("dcaSeriesSavings")}
                stroke="var(--success)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="gold"
                name={t("dcaSeriesGold")}
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm">
          {t("dcaPurchases")} · {r.purchaseCount}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="num w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">{t("dcaColDate")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("dcaColPrice")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("dcaColGrams")}</th>
                <th className="py-1 text-right font-normal">{t("dcaColCost")}</th>
              </tr>
            </thead>
            <tbody>
              {r.purchases.map((p) => (
                <tr key={p.date} className="border-t">
                  <td className="py-1 pr-3">{p.date}</td>
                  <td className="py-1 pr-3 text-right">{money(p.costBase / p.grams)}</td>
                  <td className="py-1 pr-3 text-right">{p.grams.toFixed(3)}</td>
                  <td className="py-1 text-right">{money(p.costBase)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="space-y-1 text-xs text-muted-foreground">
        {r.fxMode === "today" && <p>{t("dcaNoteToday")}</p>}
        {r.fxMode === "historical" && <p>{t("dcaNoteHistorical", { rate: r.fxEnd.toFixed(4) })}</p>}
        {r.clamped && (
          <p>
            {t("dcaNoteClamped", { n: r.purchaseCount, m: r.requestedMonths, date: r.firstDate })}
          </p>
        )}
        <p>{basisIsShop ? t("dcaNoteShop", { country: countryName }) : t("dcaNoteRaw")}</p>
        <p>{t("dcaDisclaimer", { from: r.firstDate, to: r.endDate })}</p>
      </div>
    </>
  );
}
