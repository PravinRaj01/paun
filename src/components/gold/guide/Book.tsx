import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { PageFlip } from "page-flip";

export type BookHandle = {
  next: () => void;
  prev: () => void;
  /** Turn to a page; animated unless `animate` is false. */
  goTo: (index: number, animate?: boolean) => void;
};

type Props = {
  /** One node per leaf, front cover first. The first and last leaf are hard covers. */
  pages: ReactNode[];
  /** Size of one page in pixels. */
  width: number;
  height: number;
  /** One page at a time (phones) instead of a two-page spread. */
  portrait: boolean;
  startPage: number;
  reducedMotion: boolean;
  onPage: (index: number) => void;
  onReady?: () => void;
  handle?: Ref<BookHandle>;
};

/**
 * A page-turning book on top of `page-flip` (StPageFlip). The library owns each page's element and moves it around, so the pages are
 * real elements made here and filled by React through portals: React never sees them move.
 */
export default function Book({ pages, width, height, portrait, startPage, reducedMotion, onPage, onReady, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const flip = useRef<PageFlip | null>(null);
  const current = useRef(startPage);
  const callbacks = useRef({ onPage, onReady });
  callbacks.current = { onPage, onReady };
  const [leaves, setLeaves] = useState<HTMLElement[] | null>(null);
  const count = pages.length;

  useImperativeHandle(
    handle,
    () => ({
      next: () => flip.current?.flipNext(),
      prev: () => flip.current?.flipPrev(),
      goTo: (index, animate = true) => {
        const book = flip.current;
        if (!book) return;
        if (animate && !reducedMotion) book.flip(index);
        else book.turnToPage(index);
      },
    }),
    [reducedMotion],
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = document.createElement("div");
    el.appendChild(root);
    const els = Array.from({ length: count }, (_, i) => {
      const leaf = document.createElement("div");
      leaf.setAttribute("data-density", i === 0 || i === count - 1 ? "hard" : "soft");
      return leaf;
    });
    let alive = true; // the library fires "init" a tick later; a book that was already torn down must stay silent
    const book = new PageFlip(root, {
      width,
      height,
      size: "fixed",
      minWidth: width,
      maxWidth: width,
      minHeight: height,
      maxHeight: height,
      startPage: Math.min(Math.max(current.current, 0), count - 1),
      showCover: true,
      usePortrait: portrait,
      drawShadow: !reducedMotion,
      maxShadowOpacity: 0.55,
      flippingTime: reducedMotion ? 1 : 800,
      showPageCorners: !reducedMotion,
      swipeDistance: 30,
      mobileScrollSupport: false,
      useMouseEvents: true,
      clickEventForward: true,
      autoSize: true,
    });
    book.loadFromHTML(els);
    book.on("flip", (e) => {
      if (!alive) return;
      current.current = e.data as number;
      callbacks.current.onPage(e.data as number);
    });
    book.on("init", () => {
      if (alive) callbacks.current.onReady?.();
    });
    flip.current = book;
    setLeaves(els);
    return () => {
      alive = false;
      flip.current = null;
      setLeaves(null);
      try {
        book.destroy();
      } catch {
        /* the library removes its own root; nothing to undo if it was already gone */
      }
    };
  }, [count, width, height, portrait, reducedMotion]);

  return <div ref={host}>{leaves?.map((leaf, i) => createPortal(pages[i], leaf, i))}</div>;
}
