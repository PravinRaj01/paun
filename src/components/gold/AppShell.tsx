import { useState, type ReactNode } from "react";
import { SpotBar } from "./SpotBar";
import { SettingsDialog } from "./SettingsDialog";
import { SideDock } from "./SideDock";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-24">
      <SpotBar onSettings={() => setOpen(true)} />
      <SideDock onSettings={() => setOpen(true)} />
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8">{children}</main>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
