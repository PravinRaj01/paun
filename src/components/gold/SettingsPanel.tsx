import { useEffect, useState } from "react";
import { Loader2, RadioTower, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGold } from "@/lib/gold-store";
import { fetchLiveSpot } from "@/lib/gold";
import { isPlausibleGeminiKey, readGeminiKey, setGeminiKey, type GeminiKeyMode } from "@/lib/gemini-key";
import { AccountSection } from "@/components/gold/AccountSection";
import { DockArranger } from "@/components/gold/DockArranger";
import { useI18n } from "@/lib/i18n";

/**
 * The Settings page. The same fields and rules the dialog had (the gold price, the display currency and its rate, the GoldAPI and
 * Gemini keys, decimals, the account block, Reset all), laid out as a page like the others, plus the arrangement of the dock.
 * The price and keys are applied when Save is pressed; the dock arrangement applies at once.
 */
export function SettingsPanel() {
  const { settings, setSettings, countries, resetAll } = useGold();
  const [spot, setSpot] = useState(String(settings.spotUsdOz));
  const [key, setKey] = useState(settings.apiKey);
  const [decimals, setDecimals] = useState(String(settings.decimals));
  const [base, setBase] = useState(settings.baseCurrency);
  const [baseRate, setBaseRate] = useState(String(settings.baseRate || 1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // the optional scanner key lives outside Settings (src/lib/gemini-key.ts) and is only applied when Save is pressed
  const [gKey, setGKey] = useState("");
  const [gMode, setGMode] = useState<GeminiKeyMode>("device");
  const { t } = useI18n();

  const currencies = ["USD", ...Array.from(new Set(countries.map((c) => c.currency).filter((c) => c !== "USD")))];
  const needsManualRate = base !== "USD" && !countries.some((c) => c.currency === base);

  // follow the saved settings (after Save, Fetch live price or Reset all) without waiting for a reload
  useEffect(() => {
    setSpot(String(settings.spotUsdOz));
    setKey(settings.apiKey);
    setDecimals(String(settings.decimals));
    setBase(settings.baseCurrency);
    setBaseRate(String(settings.baseRate || 1));
    const savedKey = readGeminiKey();
    setGKey(savedKey?.key ?? "");
    setGMode(savedKey?.mode ?? "device");
    setError("");
  }, [settings]);

  const save = () => {
    const v = Number(spot);
    if (!v || v <= 0) return setError(t("settingsErrSpot"));
    const r = Number(baseRate);
    if (needsManualRate && (!r || r <= 0)) return setError(t("settingsErrRate"));
    if (gKey.trim() && !isPlausibleGeminiKey(gKey)) return setError(t("geminiKeyInvalid"));
    if (!setGeminiKey(gKey, gMode)) return setError(t("geminiKeyNotSaved"));
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
    setError("");
    toast.success(t("settingsSavedToast"));
  };

  const fetchLive = async () => {
    if (!key.trim()) return setError(t("settingsErrKey"));
    setLoading(true);
    setError("");
    try {
      const price = await fetchLiveSpot(key.trim());
      setSpot(price.toFixed(2));
      setSettings((s) => ({ ...s, spotUsdOz: price, apiKey: key.trim(), source: "live", updatedAt: new Date().toISOString() }));
    } catch (e) {
      setError(t("settingsErrFetch", { reason: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  };

  const card = "space-y-4 rounded-lg border bg-card p-4 sm:p-5";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="font-display text-2xl">{t("settings")}</h2>
        <p className="text-sm text-muted-foreground">{t("browserOnly")}</p>
      </div>

      <section className={card}>
        <h3 className="font-display text-xl">{t("sectionPrices")}</h3>
        <div className="space-y-2">
          <Label htmlFor="spot">{t("globalSpot")}</Label>
          <Input id="spot" className="num" type="number" inputMode="decimal" value={spot} onChange={(e) => setSpot(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="base">{t("displayCurrency")}</Label>
          <Select value={base} onValueChange={setBase}>
            <SelectTrigger id="base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {base === "USD" ? t("currencyAllUsd") : needsManualRate ? t("currencyNeedsRate") : t("currencyFromList", { cur: base })}
          </p>
          {needsManualRate && (
            <Input
              className="num"
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              placeholder={t("rateUsd")}
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
            />
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="dec">{t("decimals")}</Label>
          <Input id="dec" className="num" type="number" inputMode="numeric" min={0} max={4} value={decimals} onChange={(e) => setDecimals(e.target.value)} />
        </div>
      </section>

      <DockArranger />

      <section className={card}>
        <h3 className="font-display text-xl">{t("sectionLive")}</h3>
        <div className="space-y-2">
          <Label htmlFor="key">{t("apiKey")}</Label>
          <Input id="key" type="password" placeholder="goldapi-xxxx" value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t("keyHint")}</p>
          <Button variant="outline" size="sm" onClick={fetchLive} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
            {t("fetchLive")}
          </Button>
        </div>
      </section>

      <section className={card}>
        <h3 className="font-display text-xl">{t("sectionScanner")}</h3>
        <div className="space-y-2">
          <Label htmlFor="gkey">{t("geminiKeyLabel")}</Label>
          <Input id="gkey" type="password" autoComplete="off" placeholder="AIza…" value={gKey} onChange={(e) => setGKey(e.target.value)} />
          <div className="space-y-1 text-xs">
            {(["device", "session"] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="gmode" checked={gMode === m} onChange={() => setGMode(m)} />
                {t(m === "device" ? "geminiKeyDevice" : "geminiKeySession")}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("geminiKeyHint")}</p>
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-xs text-gold underline">
            {t("geminiKeyGet")}
          </a>
        </div>
      </section>

      <AccountSection />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            resetAll();
            toast.success(t("settingsResetToast"));
          }}
        >
          <RotateCcw className="h-4 w-4" /> {t("resetAll")}
        </Button>
        <Button onClick={save}>{t("save")}</Button>
      </div>
    </div>
  );
}
