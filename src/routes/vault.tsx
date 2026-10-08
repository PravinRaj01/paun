import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Camera, Download, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/gold/AppShell";
import { BetaBadge, ScanReceiptDialog } from "@/components/gold/ScanReceiptDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGold } from "@/lib/gold-store";
import { baseRateOf, fineOf, fmt, GRAMS_PER_OUNCE, PURITIES, sellQuote, DEFAULT_TRADE, type PurityId, type VaultItem } from "@/lib/gold";
import { formatCalendarDate, localToday } from "@/lib/datetime";
import { useI18n, type CopyKey } from "@/lib/i18n";
import { scanToVaultForm, type ScanResponse } from "@/lib/scan";
import { parseVaultImport, type SkipReason } from "@/lib/vault-import";
import { toast } from "sonner";

/** Plain-language names for why an imported item was skipped (shown in the result toast). */
const SKIP_COPY: Record<SkipReason, CopyKey> = {
  notItem: "vaultSkipItem",
  weight: "vaultSkipWeight",
  purity: "vaultSkipPurity",
  paid: "vaultSkipPaid",
  date: "vaultSkipDate",
  duplicate: "vaultSkipDuplicate",
};

export const Route = createFileRoute("/vault")({
  head: () => ({
    meta: [
      { title: "Personal Gold Vault — Paun" },
      { name: "description", content: "Track the gold you own with live value and profit or loss, saved privately on your device." },
      { property: "og:title", content: "Personal Gold Vault — Paun" },
      { property: "og:description", content: "Track the gold you own with live value and profit or loss, saved privately on your device." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultPage,
});

function VaultPage() {
  const { vault, setVault, settings, countries, setTrade } = useGold();
  const { t, language } = useI18n();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;
  const money = (n: number) => fmt(n * base, cur, settings.decimals);
  const spotG = settings.spotUsdOz / GRAMS_PER_OUNCE;
  const [form, setForm] = useState({ name: "", weight: "", purity: "916" as PurityId, paid: "", date: "" });
  // the date field starts as the viewer's local today; set after mount because the server (UTC) and the browser can disagree on the date
  useEffect(() => setForm((f) => (f.date ? f : { ...f, date: localToday() })), []);

  const rows = vault.map((it) => {
    const value = it.weight * fineOf(it.purity) * spotG;
    const sell = sellQuote({ ...DEFAULT_TRADE, weight: it.weight, purity: it.purity, melting: 0 }, settings.spotUsdOz).payout;
    return { it, value, sell, pl: sell - it.paidUsd };
  });
  const tot = rows.reduce((a, r) => ({ paid: a.paid + r.it.paidUsd, value: a.value + r.value, sell: a.sell + r.sell }), { paid: 0, value: 0, sell: 0 });
  const totPl = tot.sell - tot.paid;
  const tone = (n: number) => (n >= 0 ? "text-success" : "text-destructive");

  const add = () => {
    const w = Number(form.weight);
    if (!(w > 0)) return;
    setVault((v) => [...v, { id: crypto.randomUUID(), name: form.name || `${w} g ${form.purity}`, weight: w, purity: form.purity, paidUsd: Math.max(0, Number(form.paid) / base), date: form.date }]);
    setForm((f) => ({ ...f, name: "", weight: "", paid: "" }));
  };
  // The scanner only FILLS the form below; the user checks every field and presses Add themselves.
  const SCAN_FIELD: Record<"weight" | "purity" | "paid" | "date", CopyKey> = { weight: "scanFieldWeight", purity: "scanFieldPurity", paid: "scanFieldPaid", date: "scanFieldDate" };
  const onScanRead = (res: ScanResponse) => {
    if (!res.readable) {
      toast.error(t("scanNotReceipt"));
      return;
    }
    const fill = scanToVaultForm(res.fields, { settings, countries });
    setForm((f) => ({ ...f, ...fill.patch }));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const notes = [t("scanFilled")];
    if (fill.unread.length) {
      const fields = fill.unread.map((k) => t(SCAN_FIELD[k])).join(", ");
      notes.push(t("scanMissing", { fields, them: fill.unread.length > 1 ? (language === "ms" ? "semuanya" : "them") : (language === "ms" ? "medan itu" : "it") }));
    }
    if (fill.unknownCurrency) notes.push(t("scanUnknownCurrency", { currency: fill.unknownCurrency }));
    if (res.confidence !== "high") notes.push(t("scanHardToRead"));
    const caution = fill.unread.length > 0 || res.confidence !== "high";
    (caution ? toast.warning : toast.success)(notes.join(" "), { duration: 12_000 });
  };
  const sellThis = (it: VaultItem) => {
    setTrade((p) => ({ ...p, side: "sell", weight: it.weight, purity: it.purity, askingPrice: 0 }));
    void nav({ to: "/dashboard" });
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(vault, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "paun-vault.json"; a.click();
    URL.revokeObjectURL(url);
  };
  // Validates the file, ADDS the good items to the vault (never replaces it) and says exactly what happened.
  const importJson = async (f: File) => {
    let text = "";
    try {
      text = await f.text();
    } catch {
      toast.error(t("vaultImportInvalidJson"));
      return;
    } finally {
      if (fileRef.current) fileRef.current.value = ""; // so picking the same file again still triggers onChange
    }
    const res = parseVaultImport(text, vault);
    if (!res.ok) {
      toast.error(t(res.error === "invalidJson" ? "vaultImportInvalidJson" : "vaultImportNotArray"));
      return;
    }
    if (res.items.length) setVault((v) => [...v, ...res.items]);
    const head =
      res.imported === 0 ? t("vaultImportNone") : res.imported === 1 ? t("vaultImportOne") : t("vaultImportMany", { n: res.imported });
    const reasons = (Object.entries(res.skipped) as [SkipReason, number][])
      .map(([reason, n]) => `${t(SKIP_COPY[reason])}${n > 1 ? ` ×${n}` : ""}`)
      .join(", ");
    const message = res.skippedTotal ? `${head} (${t("vaultImportSkipped", { skipped: res.skippedTotal, reasons })})` : head;
    (res.imported > 0 ? toast.success : toast.warning)(message);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">{t("vaultTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("vaultHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setScanOpen(true)}><Camera className="mr-1 h-4 w-4" />{t("scanButton")}<BetaBadge onPrimary /></Button>
            <Button size="sm" variant="outline" onClick={exportJson} disabled={!vault.length}><Download className="mr-1 h-4 w-4" />{t("exportJson")}</Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" />{t("importJson")}</Button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          {[[t("totalPaid"), money(tot.paid), ""], [t("currentValue"), money(tot.value), ""], [t("sellValue"), money(tot.sell), ""], [t("profitLoss"), money(totPl), tone(totPl)]].map(([l, v, c]) => (
            <div key={l} className="rounded-lg border bg-card p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{l}</div>
              <div className={`num mt-1 text-xl ${c}`}>{v}</div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {rows.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("emptyVault")}</p>}
          {rows.map(({ it, value, sell, pl }) => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.name}</div>
                <div className="num text-xs text-muted-foreground">{it.weight} g · {it.purity} · {formatCalendarDate(it.date, language)} ·{t("paidPrice")} {money(it.paidUsd)}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm">{money(value)} <span className="text-xs text-muted-foreground">/ {money(sell)}</span></div>
                <div className={`num text-xs ${tone(pl)}`}>{pl >= 0 ? "+" : ""}{money(pl)}{it.paidUsd > 0 && ` (${((pl / it.paidUsd) * 100).toFixed(1)}%)`}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="text-gold" onClick={() => sellThis(it)}>{t("sellThis")}</Button>
                <Button size="icon" variant="ghost" aria-label={t("remove")} onClick={() => setVault((v) => v.filter((x) => x.id !== it.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>

        <div ref={formRef} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-5 sm:items-end">
          <div className="space-y-1.5 sm:col-span-2"><Label>{t("itemName")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rantai 916" /></div>
          <div className="space-y-1.5"><Label>{t("weight")}</Label><Input type="number" inputMode="decimal" className="num" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("purity")}</Label>
            <Select value={form.purity} onValueChange={(v) => setForm({ ...form, purity: v as PurityId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PURITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>{t("paidPrice")} ({cur})</Label><Input type="number" inputMode="decimal" className="num" value={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>{t("boughtOn")}</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <Button className="sm:col-start-5" onClick={add}>{t("addItem")}</Button>
        </div>
      </div>
      <ScanReceiptDialog open={scanOpen} onOpenChange={setScanOpen} onRead={onScanRead} />
    </AppShell>
  );
}
