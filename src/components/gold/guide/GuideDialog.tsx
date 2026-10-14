import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import type { BookHandle } from "./Book";
import { renderPage } from "./pages";
import { buildPages, pageIndexOf, type TopicId } from "./topics";

const Book = lazy(() => import("./Book"));

const STORAGE_KEY = "gold-assistant:guide-page";
const RATIO = 1.42; // page height over width

const readPage = (): number | null => {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const writePage = (n: number) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* a remembered page is a convenience, not state */
  }
};

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

/** The Gold guide as a book: one page on a phone, a two-page spread on a larger screen. `topic` opens it at that page. */
export default function GuideDialog({ open, topic, onOpenChange }: { open: boolean; topic?: TopicId | undefined; onOpenChange: (open: boolean) => void }) {
  const { language, t } = useI18n();
  const reduced = useReducedMotion();
  const vp = useViewport();
  const pages = useMemo(() => buildPages(), []);
  const total = pages.length;
  const contentsPage = 1;

  const portrait = vp.w < 700;
  const metrics = useMemo(() => {
    if (portrait) {
      const availW = vp.w - 32;
      const h = Math.min(vp.h - 170, availW * RATIO);
      const w = Math.max(240, Math.floor(h / RATIO));
      return { width: w, height: Math.floor(w * RATIO), portrait };
    }
    const h = Math.min(540, vp.h - 190);
    const w = Math.min(Math.floor(h / RATIO), Math.floor((vp.w - 64) / 2));
    return { width: w, height: Math.floor(w * RATIO), portrait };
  }, [vp.w, vp.h, portrait]);

  // where to open: a deep link, else the page last read, else the cover
  const start = useRef<number | null>(null);
  if (open && start.current === null) {
    const deep = topic ? pageIndexOf(topic, pages) : null;
    const remembered = readPage();
    start.current = deep ?? (remembered !== null && remembered < total - 1 ? remembered : 0);
  }
  if (!open) start.current = null;
  const startPage = start.current ?? 0;

  const [page, setPage] = useState(startPage);
  useEffect(() => setPage(startPage), [startPage, open]);

  const book = useRef<BookHandle>(null);
  const goTo = useCallback((i: number) => book.current?.goTo(i, true), []);
  const nav = useMemo(() => ({ goTo, pageOf: (id: TopicId) => pageIndexOf(id, pages) ?? 0, contentsPage }), [goTo, pages]);

  const leaves = useMemo(
    () => pages.map((def, i) => renderPage(def, i, total, metrics, nav)),
    // the pages read the language through the i18n hook; the key makes them rebuild when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, total, metrics, nav, language],
  );

  const onPage = useCallback((i: number) => {
    setPage(i);
    if (i > 0 && i < total - 1) writePage(i);
  }, [total]);

  // the cover opens by itself the first time, so the book feels like it is being opened
  const onReady = useCallback(() => {
    if (startPage === 0 && !reduced) window.setTimeout(() => book.current?.next(), 380);
  }, [startPage, reduced]);

  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") book.current?.next();
      else if (e.key === "ArrowLeft") book.current?.prev();
      else if (e.key === "Home") goTo(contentsPage);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, goTo]);

  // stacked page edges: thicker on the side with more pages left
  const inSpread = page > 0 && page < total - 1;
  const edge = (n: number) => Math.round((n / total) * 14);
  const rightEdge = inSpread ? edge(total - 1 - page) : 0;
  const leftEdge = inSpread && !portrait ? edge(page) : 0;
  const bookWidth = portrait ? metrics.width : metrics.width * 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none sm:max-w-none [&>button]:hidden">
        <DialogTitle className="sr-only">{t("guide")}</DialogTitle>
        <DialogDescription className="sr-only">{t("guideDrag")}</DialogDescription>
        <div className="flex flex-col items-center gap-3" style={{ minWidth: Math.min(bookWidth, vp.w - 16) }}>
          <div className="flex w-full justify-end">
            <DialogClose asChild>
              <button type="button" aria-label={t("guideClose")} className="rounded-full border bg-card p-2 text-muted-foreground shadow hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>

          <motion.div
            initial={reduced ? false : { opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative"
            style={{ width: bookWidth, height: metrics.height }}
          >
            <div
              aria-hidden
              className="absolute inset-y-1 rounded-r-sm transition-[width] duration-300"
              style={{ right: -rightEdge, width: rightEdge, background: "repeating-linear-gradient(90deg, var(--border) 0 1px, var(--card) 1px 3px)" }}
            />
            <div
              aria-hidden
              className="absolute inset-y-1 rounded-l-sm transition-[width] duration-300"
              style={{ left: -leftEdge, width: leftEdge, background: "repeating-linear-gradient(90deg, var(--card) 0 2px, var(--border) 2px 3px)" }}
            />
            <div className="relative h-full w-full shadow-2xl">
              <Suspense fallback={<div style={{ width: bookWidth, height: metrics.height }} />}>
                <Book
                  key={`${language}-${portrait}`}
                  handle={book}
                  pages={leaves}
                  width={metrics.width}
                  height={metrics.height}
                  portrait={portrait}
                  startPage={startPage}
                  reducedMotion={reduced}
                  onPage={onPage}
                  onReady={onReady}
                />
              </Suspense>
            </div>
          </motion.div>

          <div className="flex items-center gap-4">
            <button type="button" aria-label={t("guidePrev")} disabled={page === 0} onClick={() => book.current?.prev()} className="rounded-full border bg-card p-2 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="num text-xs text-muted-foreground" aria-live="polite" data-testid="guide-counter">{page + 1} / {total}</span>
            <button type="button" aria-label={t("guideNext")} disabled={page >= total - 1} onClick={() => book.current?.next()} className="rounded-full border bg-card p-2 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">{t("guideTurn")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
