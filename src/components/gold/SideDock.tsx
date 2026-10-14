import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, Calculator, Coins, LayoutGrid, Vault, type LucideIcon } from "lucide-react";
import { GoldGuide } from "./GoldGuide";
import { useI18n } from "@/lib/i18n";
import { activeNav, type NavId } from "@/lib/nav";

type Item = { id: NavId; to: "/" | "/dashboard" | "/vault" | "/more" | null; icon: LucideIcon };

const ITEMS: Item[] = [
  { id: "today", to: "/", icon: Coins },
  { id: "check", to: "/dashboard", icon: Calculator },
  { id: "vault", to: "/vault", icon: Vault },
  { id: "guide", to: null, icon: BookOpen },
  { id: "more", to: "/more", icon: LayoutGrid },
];

/**
 * The main navigation: five places, each with its name always visible (a phone has no hover). At the bottom of a phone, down the
 * left of a wider screen. Plain links and buttons: no animation that moves the targets under a finger.
 */
export function SideDock() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [guide, setGuide] = useState(false);
  const { t } = useI18n();
  const active = guide ? "guide" : activeNav(path);
  const label: Record<NavId, string> = { today: t("navToday"), check: t("navCheck"), vault: t("navVault"), guide: t("navGuide"), more: t("navMore") };

  const tab = (it: Item, wide: boolean) => {
    const on = active === it.id;
    const cls = `relative flex flex-col items-center justify-center gap-1 rounded-xl text-xs ${wide ? "h-16 w-20" : "min-h-14 py-2"} ${on ? "text-gold" : "text-muted-foreground hover:text-foreground"}`;
    const body = (
      <>
        <it.icon className="h-5 w-5" aria-hidden />
        <span className="leading-none">{label[it.id]}</span>
        {on && <span aria-hidden className={`absolute rounded-full bg-primary ${wide ? "-left-1 top-1/2 h-6 w-1 -translate-y-1/2" : "inset-x-5 top-0 h-0.5"}`} />}
      </>
    );
    return it.to ? (
      <Link key={it.id} to={it.to} className={cls} aria-current={on ? "page" : undefined}>
        {body}
      </Link>
    ) : (
      <button key={it.id} type="button" className={cls} onClick={() => setGuide(true)}>
        {body}
      </button>
    );
  };

  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">{ITEMS.map((it) => tab(it, false))}</div>
      </nav>
      <nav aria-label="Main" className="fixed bottom-0 left-0 top-0 z-30 hidden w-24 flex-col items-center gap-2 border-r bg-background/95 pt-24 backdrop-blur md:flex">
        {ITEMS.map((it) => tab(it, true))}
      </nav>
      <GoldGuide open={guide} onOpenChange={setGuide} />
    </>
  );
}
