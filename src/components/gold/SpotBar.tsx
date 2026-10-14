import { Link } from "@tanstack/react-router";
import { useCallback, useState, type MouseEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeRipple } from "./ThemeRipple";
import { Button } from "@/components/ui/button";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";

/**
 * The top bar: the name, the language and the theme. The price is not repeated here; Today and the checks show it, with its source
 * and time, in the one unit a shopper uses (per gram, for the purity in hand).
 */
export function SpotBar() {
  const { theme, toggleTheme } = useGold();
  const { t, language, setLanguage } = useI18n();
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null);
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
    if (doc.startViewTransition && !reduce) {
      doc.startViewTransition(toggleTheme);
    } else {
      toggleTheme();
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      {ripple && <ThemeRipple key={ripple.id} x={ripple.x} y={ripple.y} onDone={clearRipple} />}
      <div className="mx-auto max-w-7xl px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <img src="/icon-192.png" alt="" width={28} height={28} className="shrink-0 rounded-md" />
            <Logo className="truncate text-base sm:text-lg" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex rounded-full border p-0.5 text-xs" role="group" aria-label={t("language")}>
              {(["en", "ms"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  aria-pressed={language === code}
                  className={`rounded-full px-2.5 py-1.5 ${language === code ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {code === "en" ? "EN" : "BM"}
                </button>
              ))}
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
