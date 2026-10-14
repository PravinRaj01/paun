import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { GoldMap } from "@/components/gold/GoldMap";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/world")({
  head: () => ({
    meta: [
      { title: "Gold prices around the world — Paun" },
      { name: "description", content: "A map of what a gram of gold costs in different countries." },
      { property: "og:title", content: "Gold prices around the world — Paun" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: World,
});

function World() {
  const { settings, hydrated } = useGold();
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h2 className="font-display text-2xl">{t("moreWorld")}</h2>
          <p className="text-sm text-muted-foreground">{t("worldHint")}</p>
        </div>
        {hydrated && <GoldMap spotUsdOz={settings.spotUsdOz} />}
      </div>
    </AppShell>
  );
}
