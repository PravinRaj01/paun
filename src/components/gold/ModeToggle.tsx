import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";

export function ModeToggle() {
  const { settings, setSettings } = useGold();
  const { t } = useI18n();
  return (
    <div className="flex w-full rounded-full border p-0.5 text-[11px]" title="Simple: plain answers. Pro: full breakdown & arbitrage.">
      {(["simple", "pro"] as const).map((m) => (
        <button key={m} type="button" onClick={() => setSettings((s) => ({ ...s, mode: m }))}
          className={`flex-1 rounded-full px-2 py-1 text-center transition-colors ${settings.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
          {m === "simple" ? t("simple") : t("pro")}
        </button>
      ))}
    </div>
  );
}
