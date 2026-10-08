import { AlertTriangle, Minus, Plus } from "lucide-react";
import { BetaBadge } from "@/components/gold/ScanReceiptDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localToday } from "@/lib/datetime";
import { fmt, PURITIES, type PurityId } from "@/lib/gold";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";
import { blankRow, paidSum, reviewIsValid, rowProblems, totalsDiffer, type Review, type ReviewRow } from "@/lib/scan-review";

/**
 * The step between a scan and the Vault: every gold piece the scanner found, as a card the user can edit, remove with (-), or add to.
 * A receipt can list several pieces. Nothing is saved until "Add N pieces" is pressed.
 */
export function ScanReview({
  review,
  onChange,
  onAdd,
  onDiscard,
}: {
  review: Review;
  onChange: (next: Review) => void;
  onAdd: () => void;
  onDiscard: () => void;
}) {
  const { settings } = useGold();
  const { t } = useI18n();
  const cur = settings.baseCurrency;
  const money = (n: number) => fmt(n, cur, settings.decimals);
  const { rows } = review;
  const setRows = (next: ReviewRow[]) => onChange({ ...review, rows: next });
  const patch = (id: string, change: Partial<ReviewRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const valid = reviewIsValid(rows);
  const differs = totalsDiffer(rows, review.receiptTotal);
  const notes: string[] = [];
  if (review.confidence !== "high") notes.push(t("scanHardToRead"));
  if (review.unknownCurrency) notes.push(t("scanUnknownCurrency", { currency: review.unknownCurrency }));
  if (!review.dateFromReceipt) notes.push(t("scanNoDate"));
  if (differs) notes.push(t("scanTotalsDiffer"));
  const bad = (invalid: boolean) => (invalid ? "border-destructive/70" : "");

  return (
    <section aria-label={t("scanReviewTitle")} className="space-y-3 rounded-lg border border-gold/40 bg-card p-4" data-testid="scan-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg">
          {t("scanReviewTitle")}
          <BetaBadge />
        </h3>
        <span className="num text-xs text-muted-foreground">{rows.length === 1 ? t("scanReviewOne") : t("scanReviewMany", { n: rows.length })}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t("scanReviewHint")}</p>

      {notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-gold/40 bg-gold-soft p-3 text-xs">
          {notes.map((n) => (
            <li key={n} className="flex gap-2">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-gold" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t("scanNoPieces")}</p>}

      <div className="space-y-3">
        {rows.map((row, i) => {
          const problems = rowProblems(row);
          return (
            <div key={row.id} className="space-y-2 rounded-md border bg-background/40 p-3" data-testid="scan-row">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{t("scanPieceN", { n: i + 1 })}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={t("scanRemoveRow")} title={t("scanRemoveRow")} onClick={() => setRows(rows.filter((r) => r.id !== row.id))}>
                  <Minus className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>{t("itemName")}</Label>
                  <Input value={row.name} onChange={(e) => patch(row.id, { name: e.target.value })} placeholder="Rantai 916" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("weight")}</Label>
                  <Input type="number" inputMode="decimal" className={`num ${bad(problems.includes("weight"))}`} value={row.weight} onChange={(e) => patch(row.id, { weight: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("purity")}</Label>
                  <Select value={row.purity} onValueChange={(v) => patch(row.id, { purity: v as PurityId })}>
                    <SelectTrigger className={bad(problems.includes("purity"))}>
                      <SelectValue placeholder={t("scanChoosePurity")} />
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
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>
                    {t("paidPrice")} ({cur})
                  </Label>
                  <Input type="number" inputMode="decimal" className={`num ${bad(problems.includes("paid"))}`} value={row.paid} onChange={(e) => patch(row.id, { paid: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>{t("boughtOn")}</Label>
                  <Input type="date" className={bad(problems.includes("date"))} value={row.date} onChange={(e) => patch(row.id, { date: e.target.value })} />
                </div>
              </div>
              {problems.length > 0 && <p className="text-xs text-destructive">{t("scanRowInvalid")}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <Button size="sm" variant="outline" onClick={() => setRows([...rows, blankRow(crypto.randomUUID(), rows.at(-1)?.date ?? localToday())])}>
          <Plus className="mr-1 h-4 w-4" />
          {t("scanAddRow")}
        </Button>
        <div className="num text-right">
          {review.receiptTotal !== null && <div>{t("scanReceiptTotal", { total: money(review.receiptTotal) })}</div>}
          {rows.some((r) => r.paid.trim() !== "") && <div>{t("scanPricesSum", { sum: money(paidSum(rows)) })}</div>}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button variant="ghost" onClick={onDiscard}>
          {t("scanDiscard")}
        </Button>
        <Button onClick={onAdd} disabled={!valid}>
          {rows.length === 1 ? t("scanAddOne") : t("scanAddMany", { n: rows.length })}
        </Button>
      </div>
    </section>
  );
}
