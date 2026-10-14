import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { Today } from "@/components/gold/Today";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paun — Is this gold price fair?" },
      {
        name: "description",
        content: "Today's gold price in ringgit per gram, and a quick check of a shop's quote or buy-back offer.",
      },
      { property: "og:title", content: "Paun — Is this gold price fair?" },
      {
        property: "og:description",
        content: "Today's gold price per gram, and a quick check of what a shop quotes you to buy or offers you to sell.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <AppShell>
      <Today />
    </AppShell>
  );
}
