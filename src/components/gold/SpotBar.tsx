import { Link } from "@tanstack/react-router";
import { useCallback, useState, type MouseEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeRipple } from "./ThemeRipple";
import { Button } from "@/components/ui/button";
import { useGold } from "@/lib/gold-store";
import { baseRateOf, fmt, GRAMS_PER_OUNCE } from "@/lib/gold";
import { useI18n } from "@/lib/i18n";

export function SpotBar(_: { onSettings: () => void }) {
  const { settings, countries, theme, toggleTheme } = useGold();
  const { t } = useI18n();
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null);
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;

  const clearRipple = useCallback(() => setRipple(null), []);

  const changeTheme = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const root = document.documentElement;
    root.style.setProperty("--theme-origin-x", `${x}px`);
    root.style.setProperty("--theme-origin-y", `${y}px`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setRipple({ id: Date.now(), x, y });

    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doc.startViewTransition(toggleTheme);
    } else {
      toggleTheme();
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      {ripple && <ThemeRipple key={ripple.id} x={ripple.x} y={ripple.y} onDone={clearRipple} />}
      <div className="mx-auto max-w-7xl px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
             <img src="/icon-192.png" alt="" width={28} height={28} className="shrink-0 rounded-md" />
            <Logo className="truncate text-base sm:text-lg" />
             <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wider text-muted-foreground">{settings.mode === "simple" ? t("simple") : t("pro")}<span className="hidden sm:inline"> · {(settings.priceBasis ?? "retail") === "retail" ? t("shopPrice") : t("rawSpot")}</span></span>
          </Link>
           <div className="flex shrink-0 items-center gap-1 sm:gap-4">
            <div className="text-right">
               <div className="num whitespace-nowrap text-xs text-gold sm:text-sm">{fmt(settings.spotUsdOz * base, cur, settings.decimals)}<span className="text-muted-foreground">/oz</span></div>
              <div className="num text-[11px] text-muted-foreground">
                {fmt((settings.spotUsdOz / GRAMS_PER_OUNCE) * base, cur, settings.decimals)}/g ·{" "}
                <span className={settings.source === "live" ? "text-success" : ""}>{settings.source === "market" ? t("closeWord") : settings.source}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={changeTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
