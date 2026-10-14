import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { Arbitrage } from "@/components/gold/Arbitrage";
import { SimpleCompare } from "@/components/gold/SimpleCompare";
import { useGold } from "@/lib/gold-store";

export const Route = createFileRoute("/countries")({
  head: () => ({
    meta: [
      { title: "Compare countries — Paun" },
      { name: "description", content: "A rough price for the same piece of gold in other countries." },
      { property: "og:title", content: "Compare countries — Paun" },
      { property: "og:description", content: "A rough price for the same piece of gold in other countries." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CountriesPage,
});

function CountriesPage() {
  const { settings } = useGold();
  return (
    <AppShell>
      {settings.mode === "simple" ? <div className="mx-auto max-w-2xl"><SimpleCompare /></div> : <Arbitrage />}
    </AppShell>
  );
}
