import { useEffect, useState } from "react";
import { Loader2, RadioTower, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGold } from "@/lib/gold-store";
import { fetchLiveSpot } from "@/lib/gold";
import { useI18n } from "@/lib/i18n";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { settings, setSettings, countries, resetAll } = useGold();
  const [spot, setSpot] = useState(String(settings.spotUsdOz));
  const [key, setKey] = useState(settings.apiKey);
  const [decimals, setDecimals] = useState(String(settings.decimals));
  const [base, setBase] = useState(settings.baseCurrency);
  const [baseRate, setBaseRate] = useState(String(settings.baseRate || 1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useI18n();

  const currencies = ["USD", ...Array.from(new Set(countries.map((c) => c.currency).filter((c) => c !== "USD")))];
  const needsManualRate = base !== "USD" && !countries.some((c) => c.currency === base);

  useEffect(() => {
    if (open) {
      setSpot(String(settings.spotUsdOz));
      setKey(settings.apiKey);
      setDecimals(String(settings.decimals));
      setBase(settings.baseCurrency);
      setBaseRate(String(settings.baseRate || 1));
      setError("");
    }
  }, [open, settings]);

  const save = () => {
    const v = Number(spot);
    if (!v || v <= 0) return setError("Enter a valid spot price.");
    const r = Number(baseRate);
    if (needsManualRate && (!r || r <= 0)) return setError("Enter the exchange rate for the display currency.");
    setSettings((s) => ({
      ...s,
      spotUsdOz: v,
      apiKey: key.trim(),
      decimals: Math.min(4, Math.max(0, Number(decimals) || 0)),
      baseCurrency: base,
      baseRate: needsManualRate ? r : s.baseRate,
      source: v === s.spotUsdOz ? s.source : "manual",
      updatedAt: v === s.spotUsdOz ? s.updatedAt : new Date().toISOString(),
    }));
    onOpenChange(false);
  };

  const fetchLive = async () => {
    if (!key.trim()) return setError("Paste an API key first.");
    setLoading(true);
    setError("");
    try {
      const price = await fetchLiveSpot(key.trim());
      setSpot(price.toFixed(2));
      setSettings((s) => ({ ...s, spotUsdOz: price, apiKey: key.trim(), source: "live", updatedAt: new Date().toISOString() }));
    } catch (e) {
      setError(`Couldn't fetch live price (${(e as Error).message}). Your manual price is still in use.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-5 sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">{t("marketSettings")}</DialogTitle>
          <DialogDescription>{t("browserOnly")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="spot">{t("globalSpot")}</Label>
            <Input id="spot" className="num" type="number" value={spot} onChange={(e) => setSpot(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="base">{t("displayCurrency")}</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="base"><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {base === "USD"
                ? "All figures shown in US dollars."
                : needsManualRate
                  ? "This currency isn't in your watchlist — enter its rate per 1 USD below."
                  : `Converted at the ${base} rate from your watchlist.`}
            </p>
            {needsManualRate && (
              <Input
                className="num"
                type="number"
                step="any"
                min={0}
                placeholder="Rate per 1 USD"
                value={baseRate}
                onChange={(e) => setBaseRate(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="key">{t("apiKey")}</Label>
            <Input id="key" type="password" placeholder="goldapi-xxxx" value={key} onChange={(e) => setKey(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Free key at goldapi.io. Requests go straight from your browser.
            </p>
            <Button variant="outline" size="sm" onClick={fetchLive} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
              {t("fetchLive")}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dec">{t("decimals")}</Label>
            <Input id="dec" className="num" type="number" min={0} max={4} value={decimals} onChange={(e) => setDecimals(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                resetAll();
                onOpenChange(false);
              }}
            >
              <RotateCcw className="h-4 w-4" /> {t("resetAll")}
            </Button>
            <Button onClick={save}>{t("save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
