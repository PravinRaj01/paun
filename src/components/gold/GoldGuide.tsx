import { lazy, Suspense, type ReactNode } from "react";
const GuideBook = lazy(() => import("./GuideBook"));
import { BookOpen, ClipboardCheck, Coins, Gem, Hammer, Landmark, ListChecks, Percent, Receipt, Repeat, Ruler, Scale, Stamp, Store, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n, type CopyKey } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";

/** The guide, one topic per page. Titles and bodies are in the locale files; each claim is traced in docs/guide-sources.md. */
const TOPICS: readonly { icon: LucideIcon; title: CopyKey; body: CopyKey }[] = [
  { icon: Store, title: "guideBoardTitle", body: "guideBoardBody" },
  { icon: Scale, title: "guideBuiltTitle", body: "guideBuiltBody" },
  { icon: Gem, title: "guidePurityTitle", body: "guidePurityBody" },
  { icon: Stamp, title: "guideStampsTitle", body: "guideStampsBody" },
  { icon: Hammer, title: "guideUpahTitle", body: "guideUpahBody" },
  { icon: Percent, title: "guideSusutTitle", body: "guideSusutBody" },
  { icon: Repeat, title: "guideTradeinTitle", body: "guideTradeinBody" },
  { icon: Landmark, title: "guideTaxTitle", body: "guideTaxBody" },
  { icon: Receipt, title: "guideReceiptTitle", body: "guideReceiptBody" },
  { icon: Ruler, title: "guideUnitsTitle", body: "guideUnitsBody" },
  { icon: Coins, title: "guideBankTitle", body: "guideBankBody" },
  { icon: ClipboardCheck, title: "guideBuyTitle", body: "guideBuyBody" },
  { icon: ListChecks, title: "guideSellTitle", body: "guideSellBody" },
];

export function GoldGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { language, t } = useI18n();
  const mobile = useIsMobile();

  const pages: ReactNode[] = [
    <div key="cover" className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold-soft text-gold"><BookOpen className="h-6 w-6" /></div>
      <div className="font-brand text-3xl tracking-wide">P<span className="text-gold">au</span>n</div>
      <div className="mt-2 font-display text-xl">{t("guide")}</div>
      <p className="mt-3 max-w-[16rem] text-xs leading-5 text-muted-foreground">{t("guideCover")}</p>
    </div>,
    ...TOPICS.map(({ icon: Icon, title, body }, i) => (
      <div key={title}>
        <div className="num text-xs text-gold">{String(i + 1).padStart(2, "0")}</div>
        <Icon className="mt-4 h-6 w-6 text-gold" />
        <h3 className="mt-3 font-display text-xl leading-tight">{t(title)}</h3>
        <div className="my-4 h-px w-10 bg-gold" />
        <p className="text-sm leading-6 text-muted-foreground">{t(body)}</p>
      </div>
    )),
  ];
  pages.push(<div key="end" />, <div key="back" className="flex h-full items-center justify-center font-brand text-4xl text-gold">P<span className="opacity-60">au</span>n</div>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none sm:max-w-none [&>button]:hidden">
        <DialogTitle className="sr-only">{t("guide")}</DialogTitle>
        <DialogDescription className="sr-only">{t("guideDrag")}</DialogDescription>
        <Suspense fallback={<div className="h-[480px] w-[320px]" />}>
          <GuideBook key={language} pages={pages} mobile={mobile}
            labels={{ prev: t("guidePrev"), next: t("guideNext") }} />
        </Suspense>
        <p className="text-center text-[11px] text-muted-foreground">{t("guideTurn")}</p>
      </DialogContent>
    </Dialog>
  );
}
