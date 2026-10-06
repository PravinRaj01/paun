import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gold/AppShell";
import { DcaBacktester } from "@/components/gold/DcaBacktester";

export const Route = createFileRoute("/dca")({
  head: () => ({
    meta: [
      { title: "Monthly Gold Plan — Paun" },
      {
        name: "description",
        content:
          "Replay real gold prices: what if you had bought gold every month, compared with a savings account?",
      },
      { property: "og:title", content: "Monthly Gold Plan — Paun" },
      {
        property: "og:description",
        content:
          "Replay real gold prices: what if you had bought gold every month, compared with a savings account?",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DcaPage,
});

function DcaPage() {
  return (
    <AppShell>
      <DcaBacktester />
    </AppShell>
  );
}
