import { useEffect, useRef } from "react";

/** Canvas water-ripple: concentric polar rings of gold dots expanding from (x, y). */
export function ThemeRipple({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const gold = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d4a63a";
    const maxR = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 60;
    const RINGS = 5;
    const GAP = 11; // spacing between dots along and across a ring
    const DURATION = 1300;
    const start = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = (now - start) / DURATION;
      ctx.clearRect(0, 0, w, h);
      if (t >= 1) return onDone();
      ctx.fillStyle = gold;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 6;
      for (let i = 0; i < RINGS; i++) {
        const local = t * 1.35 - i * 0.09; // trailing rings
        if (local <= 0 || local >= 1) continue;
        const eased = 1 - Math.pow(1 - local, 3);
        const lead = eased * maxR;
        const fade = (1 - local) * (1 - i / (RINGS + 1));
        // each ring is a band of 3 dot rows, the middle row brightest
        for (let row = -1; row <= 1; row++) {
          const r = lead + row * GAP;
          if (r <= 2) continue;
          const count = Math.max(6, Math.floor((2 * Math.PI * r) / GAP));
          const size = (row === 0 ? 2 : 1.2) * (0.6 + 0.6 * (1 - local));
          ctx.globalAlpha = fade * (row === 0 ? 0.95 : 0.45);
          const offset = (i % 2) * (Math.PI / count);
          for (let k = 0; k < count; k++) {
            const a = offset + (k / count) * Math.PI * 2;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (px < -4 || py < -4 || px > w + 4 || py > h + 4) continue;
            ctx.beginPath();
            ctx.arc(px, py, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [x, y, onDone]);

  return <canvas ref={ref} aria-hidden className="theme-ripple-canvas" />;
}
