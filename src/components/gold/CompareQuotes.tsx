import { Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compareQuotes, DEFAULT_TRADE, type QuoteForm } from "@/lib/gold";
import { useI18n } from "@/lib/i18n";
import { GuideLink, NumField, Verdict } from "./check-ui";
import { useCheck } from "./use-check";

const MAX_QUOTES = 4;

/** Buy here / Sell here: the same piece quoted by several shops. Lowest total, highest payout, and what a round trip costs. */
export function CompareQuotes() {
  const { curLabel, money, trade, setTrade } = useCheck();
  const { t } = useI18n();
  const quotes = trade.quotes;
  const patch = (i: number, p: Partial<QuoteForm>) =>
    setTrade((prev) => ({ ...prev, quotes: prev.quotes.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const add = () => setTrade((prev) => (prev.quotes.length >= MAX_QUOTES ? prev : { ...prev, quotes: [...prev.quotes, { ...DEFAULT_TRADE.quotes[0]! }] }));
  const remove = (i: number) => setTrade((prev) => ({ ...prev, quotes: prev.quotes.filter((_, j) => j !== i) }));

  const r = compareQuotes(trade.weight, quotes);
  const label = (i: number) => quotes[i]?.name.trim() || t("shopN", { n: i + 1 });

  return (
    <section className="space-y-4">
      <div className="space-y-3">
        {quotes.map((q, i) => (
          <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label>{t("shopName")}</Label>
                <Input value={q.name} placeholder={t("shopN", { n: i + 1 })} onChange={(e) => patch(i, { name: e.target.value })} />
              </div>
              {quotes.length > 1 && (
                <Button type="button" size="icon" variant="ghost" aria-label={t("remove")} onClick={() => remove(i)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label={t("quoteRate", { cur: curLabel })} value={q.sellRate} onChange={(n) => patch(i, { sellRate: n ?? 0 })} />
              <NumField label={t("quoteBuyBack", { cur: curLabel })} value={q.buyBackRate} onChange={(n) => patch(i, { buyBackRate: n ?? 0 })} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium leading-none">{t("upahLabel", { cur: curLabel })}</span>
                <div className="flex rounded-md border p-0.5 text-xs">
                  {(["flat", "perGram"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patch(i, { upahMode: m })}
                      className={`rounded px-2 py-0.5 ${q.upahMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      {m === "perGram" ? t("perGram") : t("perPiece")}
                    </button>
                  ))}
                </div>
              </div>
              <NumField label="" value={q.upah} onChange={(n) => patch(i, { upah: n ?? 0 })} />
            </div>
          </div>
        ))}
        {quotes.length < MAX_QUOTES && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1 h-4 w-4" /> {t("addShop")}
          </Button>
        )}
      </div>

      {!r.ok ? (
        <Verdict tone="info">{r.error === "weight" ? t("enterWeight") : t("needOneQuote")}</Verdict>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            <div className="rounded-lg border border-success/40 bg-card p-3 sm:p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-success">
                <TrendingDown className="h-3.5 w-3.5" /> {t("buyHere")}
              </div>
              <div className="mt-1 truncate text-lg font-medium">{r.buyHere.map(label).join(" · ")}</div>
              <div className="num text-sm text-muted-foreground">{money(r.rows.find((x) => x.index === r.buyHere[0])!.total)}</div>
            </div>
            <div className="rounded-lg border border-primary/40 bg-card p-3 sm:p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gold">
                <TrendingUp className="h-3.5 w-3.5" /> {t("sellHere")}
              </div>
              {r.sellHere.length ? (
                <>
                  <div className="mt-1 truncate text-lg font-medium">{r.sellHere.map(label).join(" · ")}</div>
                  <div className="num text-sm text-muted-foreground">{money(r.rows.find((x) => x.index === r.sellHere[0])!.payout!)}</div>
                </>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">{t("noBuyBackGiven")}</div>
              )}
            </div>
            <div className="rounded-lg border bg-card p-3 sm:p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("roundTripTitle")}</div>
              <ul className="num mt-1 space-y-0.5 text-sm">
                {r.rows.map((x) => (
                  <li key={x.index} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">{label(x.index)}</span>
                    <span>{x.roundTripLoss === null ? "—" : money(x.roundTripLoss)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("compareFoot")}</p>
        </>
      )}
      <div><GuideLink topic="buy" label={t("guideLinkBuy")} /></div>
    </section>
  );
}
