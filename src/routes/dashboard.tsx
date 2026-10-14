import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { TradeAnalyzer } from "@/components/gold/TradeAnalyzer";
import { useGold } from "@/lib/gold-store";
import { parseCheckTab, type CheckTab } from "@/lib/nav";

export const Route = createFileRoute("/dashboard")({
  // /dashboard?tab=sell opens on Sell / trade-in (the Today buttons and the old /arbitrage address use this)
  validateSearch: (search: Record<string, unknown>): { tab?: CheckTab } => {
    const tab = parseCheckTab(search["tab"]);
    return tab ? { tab } : {};
  },
  head: () => ({
    meta: [
      { title: "Check a gold price — Paun" },
      { name: "description", content: "Is the shop's price fair? Check a quote to buy, an offer to buy back, or compare shops." },
      { property: "og:title", content: "Check a gold price — Paun" },
      { property: "og:description", content: "Is the shop's price fair? Check a quote to buy, an offer to buy back, or compare shops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { tab } = Route.useSearch();
  const { setTrade, hydrated } = useGold();
  const navigate = useNavigate();
  // apply the requested tab once the saved state is in (it would overwrite it otherwise), then tidy the address
  useEffect(() => {
    if (!tab || !hydrated) return;
    setTrade((p) => (p.side === tab ? p : { ...p, side: tab }));
    void navigate({ to: "/dashboard", search: {}, replace: true });
  }, [tab, hydrated, setTrade, navigate]);
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <TradeAnalyzer />
      </div>
    </AppShell>
  );
}
