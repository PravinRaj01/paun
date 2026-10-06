import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { Arbitrage } from "@/components/gold/Arbitrage";
import { SimpleCompare } from "@/components/gold/SimpleCompare";
import { useGold } from "@/lib/gold-store";

export const Route = createFileRoute("/arbitrage")({
  head: () => ({
    meta: [
      { title: "Spread & Arbitrage — Paun" },
      { name: "description", content: "Run one gold trade against every watched country and compare head-to-head." },
      { property: "og:title", content: "Spread & Arbitrage — Paun" },
      { property: "og:description", content: "Run one gold trade against every watched country and compare head-to-head." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ArbitragePage,
});

function ArbitragePage() {
  const { settings } = useGold();
  return (
    <AppShell>
      {settings.mode === "simple" ? <div className="mx-auto max-w-2xl"><SimpleCompare /></div> : <Arbitrage />}
    </AppShell>
  );
}
