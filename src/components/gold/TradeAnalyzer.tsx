import { useI18n } from "@/lib/i18n";
import { BuyCheck } from "./BuyCheck";
import { CompareQuotes } from "./CompareQuotes";
import { NumField, PurityPicker } from "./check-ui";
import { useCheck } from "./use-check";
import { SellCheck } from "./SellCheck";

const TABS = ["buy", "sell", "compare"] as const;

/** The price check: one piece (weight and purity), then Buy, Sell / trade-in, or Buy here / Sell here. */
export function TradeAnalyzer() {
  const { trade, setTrade } = useCheck();
  const { t } = useI18n();
  const side = trade.side ?? "buy";
  const label = (k: (typeof TABS)[number]) => (k === "buy" ? t("buy") : k === "sell" ? t("sell") : t("compareTab"));
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-full border bg-card p-0.5 text-sm">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTrade((p) => ({ ...p, side: k }))}
            className={`rounded-full px-4 py-1.5 ${side === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {label(k)}
          </button>
        ))}
      </div>

      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5">
        <NumField label={t("weight")} value={trade.weight} onChange={(n) => setTrade((p) => ({ ...p, weight: n ?? 0 }))} />
        <PurityPicker label={t("purity")} value={trade.purity} onChange={(purity) => setTrade((p) => ({ ...p, purity }))} />
      </div>

      {side === "sell" ? <SellCheck /> : side === "compare" ? <CompareQuotes /> : <BuyCheck />}
    </div>
  );
}
