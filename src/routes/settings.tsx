import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { SettingsPanel } from "@/components/gold/SettingsPanel";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Paun" },
      { name: "description", content: "Your gold price, display currency, keys, and which pages sit in the dock." },
      { property: "og:title", content: "Settings — Paun" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Settings() {
  return (
    <AppShell>
      <SettingsPanel />
    </AppShell>
  );
}
