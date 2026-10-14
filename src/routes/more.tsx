import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Download, Settings2 } from "lucide-react";
import { AppShell } from "@/components/gold/AppShell";
import { DOCK_ITEMS } from "@/components/gold/dock-registry";
import { GoldGuide } from "@/components/gold/GoldGuide";
import { ModeToggle } from "@/components/gold/ModeToggle";
import { Button } from "@/components/ui/button";
import { inMore, PAGE_PATH } from "@/lib/dock";
import { useGold } from "@/lib/gold-store";
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

function MoreContent() {
  const { t, language, setLanguage } = useI18n();
  const { dock } = useGold();
  const [guide, setGuide] = useState(false);
  const [install, setInstall] = useState<BIPEvent | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  // whatever is not in the dock (the person chooses in Settings which pages those are; by default price history, the monthly plan
  // and compare countries)
  const rows = inMore(dock).map((id) => {
    const d = DOCK_ITEMS[id];
    return { id, icon: d.icon, to: PAGE_PATH[id], title: t(d.moreTitle ?? d.label), hint: d.moreHint ? t(d.moreHint) : "" };
  });

  const body = (r: (typeof rows)[number]) => (
    <>
      <r.icon className="h-5 w-5 shrink-0 text-gold" aria-hidden />
      <span className="min-w-0 flex-1 text-left">
        <span className="block font-medium">{r.title}</span>
        {r.hint && <span className="block text-sm text-muted-foreground">{r.hint}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h2 className="font-display text-2xl">{t("moreTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("moreHint")}</p>
      </div>

      {rows.length ? (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              {r.to ? (
                <Link to={r.to} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  {body(r)}
                </Link>
              ) : (
                <button type="button" onClick={() => setGuide(true)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  {body(r)}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("moreEmpty")}</p>
      )}

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
        <Button asChild variant="outline" className="w-full justify-start">
          <Link to="/settings">
            <Settings2 className="mr-2 h-4 w-4" /> {t("moreOpenSettings")}
          </Link>
        </Button>
        {install && (
          <Button variant="outline" className="w-full justify-start" onClick={() => install.prompt().then(() => setInstall(null))}>
            <Download className="mr-2 h-4 w-4" /> {t("moreInstall")}
          </Button>
        )}
      </section>
      <GoldGuide open={guide} onOpenChange={setGuide} />
    </div>
  );
}
