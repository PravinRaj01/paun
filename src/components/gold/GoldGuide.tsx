import { lazy, Suspense, type ReactNode } from "react";
const GuideBook = lazy(() => import("./GuideBook"));
import { BookOpen, CircleDollarSign, Flame, Gem, Hammer, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";

const sections = {
  en: [
    { icon: CircleDollarSign, title: "How a jewellery price is built", body: "Gold value = weight × purity × spot price. A shop may then add its counter mark-up, making charge, import duty, and local tax. Paun separates these parts so you can compare fairly." },
    { icon: Hammer, title: "Making charge / Upah", body: "Upah pays for the work and design. It may be a fixed amount or charged per gram. Ask whether the displayed price already includes upah before negotiating." },
    { icon: Flame, title: "Melting, assay, and deductions", body: "When old gold is sold or traded in, a buyer may deduct refining, assay, or expected loss. Keep this separate from the gold's intrinsic value so the deduction stays visible." },
    { icon: Gem, title: "Purity and one paun", body: "999.9 is investment-grade 24K gold; 916 is wearable 22K gold; 875 is 21K; and 750 is 18K. One paun is 8 grams, commonly associated with 916 gold." },
    { icon: ShieldCheck, title: "Before you pay", body: "All prices are estimates. Confirm the board rate, making charge, and buy-back policy with the shop." },
  ],
  ms: [
    { icon: CircleDollarSign, title: "Bagaimana harga barang kemas dikira", body: "Nilai emas = berat × ketulenan × harga spot. Kedai boleh menambah tokokan harga papan, upah, duti import dan cukai tempatan. Paun mengasingkan setiap bahagian supaya perbandingan lebih adil." },
    { icon: Hammer, title: "Upah tukang", body: "Upah ialah bayaran untuk kerja dan reka bentuk. Ia boleh dikenakan secara tetap atau setiap gram. Tanya sama ada harga yang dipamerkan sudah termasuk upah sebelum berunding." },
    { icon: Flame, title: "Lebur, ujian dan potongan", body: "Apabila emas lama dijual atau ditukar beli, pembeli mungkin menolak kos penapisan, ujian ketulenan atau susut nilai. Asingkan potongan ini daripada nilai emas sebenar." },
    { icon: Gem, title: "Ketulenan dan satu paun", body: "999.9 ialah emas pelaburan 24K; 916 ialah emas perhiasan 22K; 875 ialah 21K; dan 750 ialah 18K. Satu paun bersamaan 8 gram dan biasanya merujuk kepada emas 916." },
    { icon: ShieldCheck, title: "Sebelum membayar", body: "Semua harga ialah anggaran. Sahkan kadar papan, upah dan polisi beli balik dengan kedai." },
  ],
} as const;

export function GoldGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { language } = useI18n();
  const mobile = useIsMobile();
  const ms = language === "ms";
  const list = sections[language];

  const pages: ReactNode[] = [
    <div key="cover" className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold-soft text-gold"><BookOpen className="h-6 w-6" /></div>
      <div className="font-brand text-3xl tracking-wide">P<span className="text-gold">au</span>n</div>
      <div className="mt-2 font-display text-xl">{ms ? "Panduan Emas" : "Gold Guide"}</div>
      <p className="mt-3 max-w-[16rem] text-xs leading-5 text-muted-foreground">{ms ? "Istilah penting sebelum membeli, menjual atau menukar emas." : "The essential terms behind buying, selling, and trading gold."}</p>
    </div>,
    ...list.map(({ icon: Icon, title, body }, i) => (
      <div key={title}>
        <div className="num text-xs text-gold">0{i + 1}</div>
        <Icon className="mt-4 h-6 w-6 text-gold" />
        <h3 className="mt-3 font-display text-xl leading-tight">{title}</h3>
        <div className="my-4 h-px w-10 bg-gold" />
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    )),
  ];
  pages.push(<div key="end" />, <div key="back" className="flex h-full items-center justify-center font-brand text-4xl text-gold">P<span className="opacity-60">au</span>n</div>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none sm:max-w-none [&>button]:hidden">
        <DialogTitle className="sr-only">{ms ? "Panduan Emas" : "Gold Guide"}</DialogTitle>
        <DialogDescription className="sr-only">{ms ? "Seret sudut halaman untuk menyelak" : "Drag a page corner to turn it"}</DialogDescription>
        <Suspense fallback={<div className="h-[480px] w-[320px]" />}>
          <GuideBook key={language} pages={pages} mobile={mobile}
            labels={{ prev: ms ? "Halaman sebelum" : "Previous page", next: ms ? "Halaman seterusnya" : "Next page" }} />
        </Suspense>
        <p className="text-center text-[11px] text-muted-foreground">{ms ? "Seret atau klik sudut halaman untuk menyelak" : "Drag or click a page corner to turn"}</p>
      </DialogContent>
    </Dialog>
  );
}
