import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";

/** Explicit label of which price basis is in use. `toggle` makes it switchable. */
export function BasisBadge({ toggle, inline }: { toggle?: boolean; inline?: boolean }) {
  const { settings, setSettings } = useGold();
  const { t } = useI18n();
  const b = settings.priceBasis ?? "retail";
  const title = b === "retail" ? "Typical shop counter price (raw metal + shop mark-up)" : "Raw metal value at global spot, no shop mark-up";
  const label = b === "raw" ? t("rawSpot") : t("shopPrice");
  if (inline) return <span title={title} className="text-gold">{label.toLowerCase()}</span>;
  const cls = `rounded-full border px-2 py-0.5 text-[11px] ${b === "retail" ? "border-primary/50 text-gold" : "text-muted-foreground"}`;
  if (!toggle) return <span title={title} className={cls}>{label}</span>;
  return (
    <div className="flex w-full rounded-full border p-0.5 text-[11px]" title="Switch between raw spot value and typical shop price">
      {(["raw", "retail"] as const).map((x) => (
        <button key={x} onClick={() => setSettings((s) => ({ ...s, priceBasis: x }))}
          className={`flex-1 rounded-full px-2 py-1 text-center transition-colors ${b === x ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
          {x === "raw" ? t("rawSpot") : t("shopPrice")}
        </button>
      ))}
    </div>
  );
}
