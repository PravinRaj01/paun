import { useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { ArrowLeftRight, BookOpen, Vault, Calculator, LineChart, Settings2, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { ModeToggle } from "./ModeToggle";
import { BasisBadge } from "./BasisBadge";
import { GoldGuide } from "./GoldGuide";
import { useI18n } from "@/lib/i18n";

type Item = { to: string; label: string; icon: LucideIcon; kind: "link" | "btn" | "view" | "guide" };

const BASE = 40;
const MAX = 64;
const RANGE = 140;

function DockIcon({ item, pointer, vertical, active, onSettings, onView, onGuide }: {
  item: Item; pointer: MotionValue<number>; vertical: boolean; active: boolean; onSettings: () => void; onView: () => void; onGuide: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const dist = useTransform(pointer, (p) => {
    const el = ref.current;
    if (!el || p === Infinity) return RANGE;
    const r = el.getBoundingClientRect();
    return p - (vertical ? r.top + r.height / 2 : r.left + r.width / 2);
  });
  const sizeRaw = useTransform(dist, [-RANGE, 0, RANGE], [BASE, MAX, BASE], { clamp: true });
  const size = useSpring(sizeRaw, { mass: 0.1, stiffness: 170, damping: 12 });
  const iconSize = useTransform(size, (s) => s * 0.45);
  const Icon = item.icon;

  const body = (
    <motion.div ref={ref} style={{ width: size, height: size }}
      onHoverStart={() => setHover(true)} onHoverEnd={() => setHover(false)}
      className={`relative flex items-center justify-center rounded-2xl border bg-secondary/80 shadow-sm ${active ? "text-gold" : "text-muted-foreground"}`}>
      <motion.span style={{ width: iconSize, height: iconSize }} className="flex"><Icon className="h-full w-full" /></motion.span>
      <AnimatePresence>
        {hover && (
          <motion.span
            initial={{ opacity: 0, ...(vertical ? { x: -4 } : { y: 4 }) }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`pointer-events-none absolute whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow ${vertical ? "left-full ml-3" : "bottom-full mb-2"}`}>
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
      {active && <span className={`absolute rounded-full bg-primary ${vertical ? "-left-2 h-1.5 w-1.5" : "-bottom-2 h-1 w-1"}`} />}
    </motion.div>
  );
  return item.kind === "link"
    ? <Link to={item.to} aria-label={item.label}>{body}</Link>
    : <button type="button" onClick={item.kind === "view" ? onView : item.kind === "guide" ? onGuide : onSettings} aria-label={item.label}>{body}</button>;
}

function Dock({ vertical, onSettings, className }: { vertical: boolean; onSettings: () => void; className: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const pointer = useMotionValue(Infinity);
  const [view, setView] = useState(false);
  const [guide, setGuide] = useState(false);
  const { language, setLanguage, t } = useI18n();
  const items: Item[] = [
    { to: "/dashboard", label: t("calculator"), icon: Calculator, kind: "link" },
    { to: "/markets", label: t("markets"), icon: LineChart, kind: "link" },
    { to: "/arbitrage", label: t("arbitrage"), icon: ArrowLeftRight, kind: "link" },
    { to: "/vault", label: t("vault"), icon: Vault, kind: "link" },
    { to: "", label: t("guide"), icon: BookOpen, kind: "guide" },
    { to: "", label: t("viewOptions"), icon: SlidersHorizontal, kind: "view" },
    { to: "", label: t("settings"), icon: Settings2, kind: "btn" },
  ];
  const move = (e: React.PointerEvent) => pointer.set(vertical ? e.clientY : e.clientX);
  return (
    <>
    <AnimatePresence>
      {view && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setView(false)} />
          <motion.div
            initial={{ opacity: 0, ...(vertical ? { x: -12 } : { y: 16 }), scale: 0.96 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, ...(vertical ? { x: -12 } : { y: 16 }), scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={`fixed z-40 w-60 space-y-3 rounded-2xl border bg-popover/95 p-3 text-popover-foreground shadow-2xl backdrop-blur-xl ${vertical ? "left-24 top-1/2 -translate-y-1/2" : "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)] left-1/2 -translate-x-1/2"}`}>
            <div className="space-y-1.5">
               <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("experience")}</div>
              <ModeToggle />
            </div>
            <div className="space-y-1.5">
               <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("priceBasis")}</div>
              <BasisBadge toggle />
            </div>
             <div className="space-y-1.5 border-t pt-3">
               <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("language")}</div>
               <div className="grid grid-cols-2 rounded-full border p-0.5 text-[11px]">
                 {(["en", "ms"] as const).map((code) => (
                   <button key={code} type="button" onClick={() => setLanguage(code)} className={`rounded-full px-2 py-1 ${language === code ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                     {code === "en" ? "EN" : "BM"}
                   </button>
                 ))}
               </div>
             </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    <nav aria-label="Main"
      onPointerMove={move} onPointerDown={move}
      onPointerLeave={() => pointer.set(Infinity)} onPointerUp={(e) => e.pointerType !== "mouse" && pointer.set(Infinity)}
      className={`z-30 flex gap-2.5 rounded-3xl border bg-card/70 p-2 shadow-2xl backdrop-blur-xl ${vertical ? "flex-col items-start" : "items-end"} ${className}`}
      style={{ touchAction: "none" }}>
      {items.map((it) => (
        <DockIcon key={it.label} item={it} pointer={pointer} vertical={vertical}
          active={(it.kind === "link" && path.startsWith(it.to)) || (it.kind === "view" && view) || (it.kind === "guide" && guide)} onSettings={onSettings} onView={() => setView((v) => !v)} onGuide={() => setGuide(true)} />
      ))}
    </nav>
    <GoldGuide open={guide} onOpenChange={setGuide} />
    </>
  );
}

export function SideDock({ onSettings }: { onSettings: () => void }) {
  return (
    <>
      <Dock vertical onSettings={onSettings} className="fixed left-3 top-1/2 hidden -translate-y-1/2 md:flex" />
      <Dock vertical={false} onSettings={onSettings}
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 md:hidden" />
    </>
  );
}
