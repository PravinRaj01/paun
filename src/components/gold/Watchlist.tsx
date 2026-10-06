import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useGold } from "@/lib/gold-store";
import { baseRateOf, fmt, landedPerGram, type Country } from "@/lib/gold";
import { COUNTRY_CATALOG } from "@/lib/country-catalog";
import { useI18n } from "@/lib/i18n";

const blank = (): Country => ({ id: "", name: "", currency: "", rate: 1, duty: 0, tax: 0, premium: 5 });

function Editor({ value, onSave, onCancel }: { value: Country; onSave: (c: Country) => void; onCancel: () => void }) {
  const [c, setC] = useState(value);
  const { t } = useI18n();
  const f = (k: keyof Country, label: string, num = false) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        className={num ? "num h-8" : "h-8"}
        type={num ? "number" : "text"}
        value={(c[k] ?? 0) as string | number}
        onChange={(e) => setC({ ...c, [k]: num ? Number(e.target.value) : e.target.value })}
      />
    </label>
  );
  return (
    <div className="rounded-lg border border-primary/40 bg-card p-4">
      <div className="grid grid-cols-2 gap-3">
        {f("name", t("country"))}
        {f("currency", t("currencyCode"))}
        {f("rate", t("rateUsd"), true)}
        {f("duty", t("importDuty"), true)}
        {f("tax", t("taxVat"), true)}
        {f("premium", t("shopMarkup"), true)}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="h-4 w-4" /></Button>
        <Button
          size="sm"
          disabled={!c.name || !c.currency || c.rate <= 0}
          onClick={() => onSave({ ...c, currency: c.currency.toUpperCase().trim() })}
        >
          <Check className="h-4 w-4" /> {t("save")}
        </Button>
      </div>
    </div>
  );
}

function Picker({
  open,
  onOpenChange,
  onPick,
  onCustom,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (c: Country) => void;
  onCustom: () => void;
}) {
  const [q, setQ] = useState("");
  const { t } = useI18n();
  const needle = q.trim().toLowerCase();
  const options = COUNTRY_CATALOG.filter(
    (c) => c.name.toLowerCase().includes(needle) || c.currency.toLowerCase().includes(needle),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">{t("addCountry")}</DialogTitle>
          <DialogDescription>{t("addCountryHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input autoFocus placeholder={t("searchCountry")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {options.map((c) => (
              <button
                key={c.name}
                onClick={() => onPick({ premium: 5, ...c } as Country)}
                className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm hover:border-primary/40"
              >
                <span>
                  {c.name} <span className="num ml-1 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{c.currency}</span>
                </span>
                <span className="text-xs text-muted-foreground">{c.duty === 0 && c.tax === 0 ? t("dutyFree") : `${t("duty")} ${c.duty}% · ${t("tax")} ${c.tax}%`}</span>
              </button>
            ))}
            {options.length === 0 && (
              <p className="p-2 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
            )}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={onCustom}>
            <Plus className="h-4 w-4" /> {t("customCountry")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Watchlist() {
  const { countries, setCountries, settings, trade, setTrade } = useGold();
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const { t } = useI18n();
  const base = baseRateOf(settings, countries);

  const save = (c: Country) => {
    if (!c.id) setCountries((p) => [...p, { ...c, id: `c${Date.now()}` }]);
    else setCountries((p) => p.map((x) => (x.id === c.id ? c : x)));
    setEditing(null);
  };

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl">{t("countryWatchlist")}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">{t("watchlistHint")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPicker(true)}>
          <Plus className="h-4 w-4" /> {t("add")}
        </Button>
      </div>
      <Picker
        open={picker}
        onOpenChange={setPicker}
        onPick={(c) => {
          save(c);
          setPicker(false);
        }}
        onCustom={() => {
          setPicker(false);
          setEditing("new");
        }}
      />
      <div className="space-y-2">
        {editing === "new" && <Editor value={blank()} onSave={save} onCancel={() => setEditing(null)} />}
        {countries.map((c) =>
          editing === c.id ? (
            <Editor key={c.id} value={c} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <div
              key={c.id}
              className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-card px-3 py-3 transition-colors sm:px-4 ${
                trade.countryId === c.id ? "border-primary/60" : "hover:border-primary/30"
              }`}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => setTrade((t) => ({ ...t, countryId: c.id }))}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="num rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{c.currency}</span>
                </div>
                 <div className="mt-1 text-[11px] text-muted-foreground">
                   {c.duty === 0 && c.tax === 0 ? t("dutyFree") : `${t("duty")} ${c.duty}% · ${t("tax")} ${c.tax}%`}
                 </div>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="text-right">
                  <div className="num text-sm text-gold">{fmt(landedPerGram(c, settings.spotUsdOz, settings.priceBasis ?? "retail") * c.rate, c.currency, settings.decimals)}</div>
                  <div className="num text-xs text-muted-foreground">{fmt(landedPerGram(c, settings.spotUsdOz, settings.priceBasis ?? "retail") * base, settings.baseCurrency, settings.decimals)}</div>
                </div>
                <div className="flex gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                   <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("edit")} onClick={() => setEditing(c.id)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                     className="h-8 w-8"
                     aria-label={t("remove")}
                    onClick={() => setCountries((p) => p.filter((x) => x.id !== c.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ),
        )}
        {countries.length === 0 && editing !== "new" && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("noCountries")}
          </p>
        )}
      </div>
    </section>
  );
}
