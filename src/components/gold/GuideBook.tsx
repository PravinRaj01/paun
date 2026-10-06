import { forwardRef, useRef, useState, type ReactNode } from "react";
import HTMLFlipBook from "react-pageflip";
import { ChevronLeft, ChevronRight } from "lucide-react";

const Book = HTMLFlipBook as unknown as React.ComponentType<Record<string, unknown>>;

export const Leaf = forwardRef<HTMLDivElement, { children?: ReactNode; n?: number | undefined; hard?: boolean }>(
  ({ children, n, hard }, ref) => (
    <div ref={ref} data-density={hard ? "hard" : "soft"} className="overflow-hidden bg-card text-card-foreground">
      <div className="flex h-full flex-col p-6 sm:p-8"
        style={{ backgroundImage: "radial-gradient(ellipse at center, transparent 60%, color-mix(in oklab, var(--foreground) 6%, transparent))" }}>
        <div className="flex-1">{children}</div>
        {n !== undefined && <div className="num text-center text-[10px] text-muted-foreground">{n}</div>}
      </div>
    </div>
  ),
);
Leaf.displayName = "Leaf";

export default function GuideBook({ pages, mobile, labels }: { pages: ReactNode[]; mobile: boolean; labels: { prev: string; next: string } }) {
  const ref = useRef<{ pageFlip: () => { flipNext: () => void; flipPrev: () => void } }>(null);
  const [page, setPage] = useState(0);
  const total = pages.length;
  const w = mobile ? 320 : 360;
  const h = mobile ? 460 : 480;
  return (
    <div className="flex flex-col items-center">
      <Book
        key={mobile ? "m" : "d"}
        ref={ref}
        width={w} height={h} size="fixed" minWidth={w} maxWidth={w} minHeight={h} maxHeight={h}
        startPage={0} drawShadow maxShadowOpacity={0.5} flippingTime={900}
        usePortrait={mobile} showCover mobileScrollSupport={false} useMouseEvents
        clickEventForward swipeDistance={20} showPageCorners disableFlipByClick={false}
        startZIndex={0} autoSize className="shadow-2xl" style={{}}
        onFlip={(e: { data: number }) => setPage(e.data)}
      >
        {pages.map((p, i) => (
          <Leaf key={i} hard={i === 0 || i === total - 1} n={i > 0 && i < total - 1 ? i : undefined}>{p}</Leaf>
        ))}
      </Book>
      <div className="mt-3 flex items-center gap-4">
        <button type="button" aria-label={labels.prev} disabled={page === 0} onClick={() => ref.current?.pageFlip().flipPrev()}
          className="rounded-full border bg-card p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
        <span className="num text-xs text-muted-foreground">{page + 1} / {total}</span>
        <button type="button" aria-label={labels.next} disabled={page >= total - 1} onClick={() => ref.current?.pageFlip().flipNext()}
          className="rounded-full border bg-card p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
