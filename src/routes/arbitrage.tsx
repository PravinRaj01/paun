import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The old Arbitrage page. Its useful half, "where is it cheapest to buy and where does it pay most to sell", is now the Buy here /
 * Sell here tab of the price check, and the rough country comparison moved to /countries. Old links and bookmarks land on the tab.
 */
export const Route = createFileRoute("/arbitrage")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", search: { tab: "compare" }, replace: true });
  },
});
