import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { TradeAnalyzer } from "@/components/gold/TradeAnalyzer";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Gold Price Calculator — Paun" },
      { name: "description", content: "Check a gold quote: pure gold value, jeweler's premium and break-even price." },
      { property: "og:title", content: "Gold Price Calculator — Paun" },
      { property: "og:description", content: "Check a gold quote: pure gold value, jeweler's premium and break-even price." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <TradeAnalyzer />
      </div>
    </AppShell>
  );
}
