import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useGold } from "@/lib/gold-store";
import { baseRateOf, BASIS_LABEL, fineOf, fmt, GRAMS_PER_OUNCE, premiumOf, PURITIES, type PurityId } from "@/lib/gold";
import { useSnapshot } from "@/lib/forecast/snapshot";
import { useI18n } from "@/lib/i18n";

// Real daily closes, so there is no intraday (1D) view. Sessions per range; ~252 trading days a year.
type HistRange = "1W" | "1M" | "1Y" | "5Y";
const RANGES: HistRange[] = ["1W", "1M", "1Y", "5Y"];
const SESSIONS: Record<HistRange, number> = { "1W": 5, "1M": 22, "1Y": 252, "5Y": 1300 };

export function SpotChart() {
  const { settings, setSettings, countries } = useGold();
  const { t } = useI18n();
  const snap = useSnapshot();
  const [range, setRange] = useState<HistRange>("1M");
  const [unit, setUnit] = useState<"oz" | "g">("g");
  const [purity, setPurity] = useState<PurityId>("999.9");
  const [countryId, setCountryId] = useState<string>("");
  const basis = settings.priceBasis ?? "retail";
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;
  const country = countries.find((c) => c.id === countryId) ?? countries.find((c) => c.currency === cur) ?? countries[0];
  const prem = country ? premiumOf(country, basis) : 0;
  const k = (base / (unit === "g" ? GRAMS_PER_OUNCE : 1)) * fineOf(purity) * (1 + prem / 100);
  const real = snap.status === "ready" ? snap.snapshot : null;
  // Real daily closes from the published snapshot. There is no invented fallback: while it loads we show a placeholder,
  // and if it cannot be loaded at all we say so.
  const data = useMemo(() => {
    if (real) {
      const h = real.longHistory;
      const rows = h.dates.flatMap((d, i) => (h.xau[i] == null ? [] : [{ t: Date.parse(`${d}T00:00:00Z`), v: h.xau[i] as number }]));
      return rows.slice(-(SESSIONS[range] + 1)).map((p) => ({ t: p.t, v: +(p.v * k).toFixed(2) }));
    }
    return [];
  }, [real, range, k]);
  if (!real) {
    return (
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        {snap.status === "error" ? (
          <p className="py-20 text-center text-sm text-muted-foreground">{t("chartUnavailable")}</p>
        ) : (
          <div className="h-72 animate-pulse rounded-md bg-muted/40" role="status" aria-label={t("chartLoading")} />
        )}
      </section>
    );
  }
  const first = data[0]?.v ?? 0, last = data[data.length - 1]?.v ?? 0;
  const hi = Math.max(...data.map((d) => d.v)), lo = Math.min(...data.map((d) => d.v));
  const chg = last - first, pct = (chg / first) * 100, up = chg >= 0;
  const color = up ? "var(--success)" : "var(--destructive)";
  const tick = (t: number) => {
    const d = new Date(t);
    return range === "5Y" ? d.toLocaleDateString([], { year: "numeric", month: "short" })
      : range === "1Y" ? d.toLocaleDateString([], { month: "short" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
  };
  const f = (n: number) => fmt(n, cur, settings.decimals);
  const local = basis === "retail" && country && country.currency !== cur ? (n: number) => fmt((n / base) * country.rate, country.currency, settings.decimals) : null;
  const seg = (on: boolean) => `whitespace-nowrap rounded px-2 py-1 ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <div>
        <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">
          Gold · {BASIS_LABEL[basis]}{basis === "retail" && country ? ` (${country.name}, +${prem}% shop mark-up)` : ""} · {purity} · per {unit === "oz" ? "troy oz" : "gram"}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
           <span className="num text-2xl text-gold sm:text-3xl">{f(last)}</span>
          {local && <span className="num text-sm text-muted-foreground">≈ {local(last)}</span>}
        </div>
        <div className="num mt-1 text-sm" style={{ color }}>{up ? "▲" : "▼"} {f(Math.abs(chg))} ({pct.toFixed(2)}%) · {range}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:flex sm:flex-wrap">
        <div className="flex rounded-md border p-0.5">
          {(["raw", "retail"] as const).map((b) => (
            <button key={b} onClick={() => setSettings((s) => ({ ...s, priceBasis: b }))} className={`flex-1 ${seg(basis === b)}`}>{BASIS_LABEL[b]}</button>
          ))}
        </div>
        <select value={country?.id} disabled={basis !== "retail"} onChange={(e) => setCountryId(e.target.value)} className="w-full rounded-md border bg-card px-2 py-1 text-foreground disabled:opacity-40 sm:w-40">
          {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={purity} onChange={(e) => setPurity(e.target.value as PurityId)} className="num w-full rounded-md border bg-card px-2 py-1 text-foreground sm:w-36">
          {PURITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <div className="flex rounded-md border p-0.5">
          {(["g", "oz"] as const).map((u) => <button key={u} onClick={() => setUnit(u)} className={`flex-1 ${seg(unit === u)}`}>/{u}</button>)}
        </div>
        <div className="col-span-2 flex rounded-md border p-0.5 sm:ml-auto">
          {RANGES.map((r) => <button key={r} onClick={() => setRange(r)} className={`num flex-1 ${seg(range === r)}`}>{r}</button>)}
        </div>
      </div>
       <div className="mt-4 h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="spotFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={40} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
             <YAxis domain={["auto", "auto"]} orientation="right" width={68} tickFormatter={(v) => f(v)} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
            <ReferenceLine y={first} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
              labelFormatter={(t: number) => new Date(t).toLocaleString()}
              formatter={(v: number) => [local ? `${f(v)} (${local(v)})` : f(v), "Price"]}
            />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill="url(#spotFill)" activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="num mt-3 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
        <div>Open <span className="text-foreground">{f(first)}</span></div>
        <div>High <span className="text-foreground">{f(hi)}</span></div>
        <div>Low <span className="text-foreground">{f(lo)}</span></div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {`${t("historyNote")} ${real.asOf}. ${basis === "retail" ? t("historyMarkup") : ""}`}
      </p>
    </section>
  );
}
