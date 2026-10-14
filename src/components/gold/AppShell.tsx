import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { OfflineNotice } from "./OfflineNotice";
import { SpotBar } from "./SpotBar";
import { SideDock } from "./SideDock";
import { VaultSyncRunner } from "./VaultSyncRunner";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-24">
      <SpotBar onSettings={() => void navigate({ to: "/settings" })} />
      <SideDock />
      <OfflineNotice />
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8">{children}</main>
      <VaultSyncRunner />
    </div>
  );
}
