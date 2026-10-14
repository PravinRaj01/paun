import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Download, LineChart, PiggyBank, Settings2, Shuffle } from "lucide-react";
import { AppShell } from "@/components/gold/AppShell";
import { ModeToggle } from "@/components/gold/ModeToggle";
import { useShell } from "@/components/gold/shell-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/more")({
  head: () => ({
    meta: [
      { title: "More — Paun" },
      { name: "description", content: "Price history, a monthly plan, compare countries, and your settings." },
      { property: "og:title", content: "More — Paun" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MorePage,
});

type BIPEvent = Event & { prompt: () => Promise<void> };

function MorePage() {
  return (
    <AppShell>
      <MoreContent />
    </AppShell>
  );
}

// inside the shell, so that the Settings button reaches the shell's dialog
function MoreContent() {
  const { t, language, setLanguage } = useI18n();
  const { openSettings } = useShell();
  const [install, setInstall] = useState<BIPEvent | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  const tools = [
    { to: "/markets", icon: LineChart, title: t("moreMarkets"), hint: t("moreMarketsHint") },
    { to: "/dca", icon: PiggyBank, title: t("moreDca"), hint: t("moreDcaHint") },
    { to: "/countries", icon: Shuffle, title: t("moreCountries"), hint: t("moreCountriesHint") },
  ] as const;

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h2 className="font-display text-2xl">{t("moreTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("moreHint")}</p>
      </div>

      <ul className="divide-y rounded-lg border bg-card">
        {tools.map((x) => (
          <li key={x.to}>
            <Link to={x.to} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
              <x.icon className="h-5 w-5 shrink-0 text-gold" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{x.title}</span>
                <span className="block text-sm text-muted-foreground">{x.hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("language")}</div>
          <div className="grid grid-cols-2 rounded-full border p-0.5 text-sm">
            {(["en", "ms"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                className={`rounded-full px-3 py-2 ${language === code ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {code === "en" ? "English" : "Bahasa Melayu"}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("experience")}</div>
          <ModeToggle />
        </div>
        <Button variant="outline" className="w-full justify-start" onClick={openSettings}>
          <Settings2 className="mr-2 h-4 w-4" /> {t("moreOpenSettings")}
        </Button>
        {install && (
          <Button variant="outline" className="w-full justify-start" onClick={() => install.prompt().then(() => setInstall(null))}>
            <Download className="mr-2 h-4 w-4" /> {t("moreInstall")}
          </Button>
        )}
      </section>
    </div>
  );
}
