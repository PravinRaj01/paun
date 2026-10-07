import { useEffect, useMemo, useRef, useState } from "react";
import { geoBounds, geoCentroid, geoContains, geoEquirectangular, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-50m.json";
import { animate, motion, useInView } from "motion/react";
import { LocateFixed, Minus, Plus, RotateCcw } from "lucide-react";
import { useGold } from "@/lib/gold-store";
import { COUNTRY_CATALOG } from "@/lib/country-catalog";
import { baseRateOf, fmt, landedPerGram, PURITIES, type Country } from "@/lib/gold";

const ALIAS: Record<string, string> = {
  "United States of America": "United States",
  "United Arab Emirates": "UAE (Dubai)",
  "S. Korea": "South Korea",
};
const DOTS: Record<string, [number, number]> = { Singapore: [103.8, 1.35], Bahrain: [50.55, 26.07], "Hong Kong": [114.17, 22.3] };
const TZ: Record<string, string> = {
  "Asia/Kuala_Lumpur": "Malaysia", "Asia/Kuching": "Malaysia", "Asia/Singapore": "Singapore", "Asia/Kolkata": "India", "Asia/Calcutta": "India",
  "Asia/Dubai": "UAE (Dubai)", "Asia/Riyadh": "Saudi Arabia", "Asia/Qatar": "Qatar", "Asia/Kuwait": "Kuwait", "Asia/Bahrain": "Bahrain",
  "Asia/Muscat": "Oman", "Europe/Istanbul": "Turkey", "Asia/Jakarta": "Indonesia", "Asia/Bangkok": "Thailand", "Asia/Ho_Chi_Minh": "Vietnam",
  "Asia/Manila": "Philippines", "Asia/Karachi": "Pakistan", "Asia/Dhaka": "Bangladesh", "Asia/Colombo": "Sri Lanka", "Asia/Shanghai": "China",
  "Asia/Hong_Kong": "Hong Kong", "Asia/Tokyo": "Japan", "Asia/Seoul": "South Korea", "Europe/London": "United Kingdom", "Europe/Berlin": "Germany",
  "Europe/Paris": "France", "Europe/Rome": "Italy", "Europe/Madrid": "Spain", "Europe/Amsterdam": "Netherlands", "Europe/Zurich": "Switzerland",
  "Europe/Stockholm": "Sweden", "Europe/Oslo": "Norway", "Europe/Warsaw": "Poland", "America/Toronto": "Canada", "Australia/Sydney": "Australia",
  "Australia/Melbourne": "Australia", "Pacific/Auckland": "New Zealand", "Africa/Johannesburg": "South Africa", "Africa/Nairobi": "Kenya",
  "Africa/Lagos": "Nigeria", "Africa/Cairo": "Egypt", "America/Sao_Paulo": "Brazil", "America/Mexico_City": "Mexico", "America/Argentina/Buenos_Aires": "Argentina",
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const K_MAX = 8;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Feat = { f: any; name: string; b: [[number, number], [number, number]] };

type DotSet = { land: Float32Array; sea: Float32Array }; // packed [cosLon, sinLon, cosLat, sinLat]
let MASK: { data: Uint8ClampedArray; w: number; h: number } | null = null;
const SETS = new Map<number, DotSet>();
function landMask(feats: Feat[]) {
  if (MASK) return MASK;
  const w = 2048, h = 1024;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  const p = geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]);
  const path = geoPath(p, ctx);
  ctx.fillStyle = "#fff";
  feats.forEach((f) => { ctx.beginPath(); path(f.f); ctx.fill(); });
  ctx.strokeStyle = "#000"; ctx.lineWidth = 0.9; // hairline border gap
  feats.forEach((f) => { ctx.beginPath(); path(f.f); ctx.stroke(); });
  MASK = { data: ctx.getImageData(0, 0, w, h).data, w, h };
  return MASK;
}
function dotSet(n: number, feats: Feat[]): DotSet {
  const hit = SETS.get(n);
  if (hit) return hit;
  const m = landMask(feats);
  const land: number[] = [], sea: number[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const lat = Math.asin(1 - (2 * (i + 0.5)) / n);
    const lon = ((i * ga) % (2 * Math.PI)) - Math.PI;
    const x = Math.min(m.w - 1, ((lon + Math.PI) / (2 * Math.PI)) * m.w) | 0;
    const y = Math.min(m.h - 1, ((Math.PI / 2 - lat) / Math.PI) * m.h) | 0;
    const v = m.data[(y * m.w + x) * 4] ?? 0;
    (v > 128 ? land : sea).push(Math.cos(lon), Math.sin(lon), Math.cos(lat), Math.sin(lat));
  }
  const s = { land: new Float32Array(land), sea: new Float32Array(sea) };
  SETS.set(n, s);
  return s;
}

function CountUp({ value, cur, decimals = 2 }: { value: number; cur: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [inView, value]);
  return <span ref={ref}>{fmt(v, cur, decimals)}</span>;
}

function Odometer({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  return (
    <span ref={ref} className="inline-flex overflow-hidden leading-[1em]" aria-label={text}>
      {text.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="relative inline-block h-[1em] w-[0.62em] overflow-hidden">
            <motion.span className="absolute left-0 top-0 flex flex-col"
              initial={{ y: "0em" }} animate={{ y: inView ? `-${Number(ch) + 10}em` : "0em" }}
              transition={{ duration: 1.6 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}>
              {Array.from({ length: 20 }, (_, n) => <span key={n} className="block h-[1em] text-center leading-[1em]">{n % 10}</span>)}
            </motion.span>
          </span>
        ) : <span key={i} className="inline-block h-[1em] leading-[1em]">{ch}</span>,
      )}
    </span>
  );
}

/** `spotUsdOz` lets the landing page price the map from the shared live feed; everywhere else the app's own price is used. */
export function GoldMap({ spotUsdOz }: { spotUsdOz?: number } = {}) {
  const { settings, setSettings, countries } = useGold();
  const spot = spotUsdOz ?? settings.spotUsdOz;
  const basis = settings.priceBasis ?? "retail";
  const base = baseRateOf(settings, countries);
  const cur = settings.baseCurrency;
  const box = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ c: Country; x: number; y: number } | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  // Mutable camera state (kept out of React so dragging is 60fps)
  const cam = useRef({ lon: -60, lat: -12, k: 1, auto: true, vx: 0, dirty: true });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const hl = useRef<{ sel: string | null; hov: string | null; mine: string | null }>({ sel: null, hov: null, mine: null });
  const tween = useRef<{ stop: () => void } | null>(null);
  const drag = useRef<{ x: number; y: number; lon: number; lat: number; moved: boolean; t: number; lx: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const feats: Feat[] = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = feature(world as any, (world as any).objects.countries) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fc.features.map((f: any) => ({ f, name: ALIAS[f.properties.name] ?? f.properties.name, b: geoBounds(f) }));
  }, []);

  const lookup = (name: string): Country | null => {
    const w = countries.find((c) => c.name === name);
    if (w) return w;
    const k = COUNTRY_CATALOG.find((c) => c.name === name);
    return k ? ({ id: name, ...k } as Country) : null;
  };
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  useEffect(() => { hl.current = { sel: selected, hov: hover?.c.name ?? null, mine }; cam.current.dirty = true; }, [selected, hover, mine]);

  const radius = () => (Math.min(size.current.w, size.current.h) / 2) * 0.9 * cam.current.k;
  const proj = () => {
    const { w, h } = size.current;
    return geoOrthographic().rotate([cam.current.lon, cam.current.lat]).scale(radius()).translate([w / 2, h / 2]).clipAngle(90);
  };

  // Render loop
  useEffect(() => {
    const cv = cvRef.current, wrap = box.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) cam.current.auto = false;
    let visible = true, raf = 0, last = performance.now();
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = w < 640 ? Math.min(w * 1.02, 460) : Math.min(Math.max(w * 0.52, 420), 600);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w, h, dpr };
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.height = `${h}px`;
      cam.current.dirty = true;
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    io.observe(cv);
    const grat = geoGraticule10();

    const draw = () => {
      const { w, h, dpr } = size.current;
      if (!w) return;
      const c = cam.current;
      const st = getComputedStyle(cv);
      const gold = st.getPropertyValue("--gold").trim() || "#d4a72c";
      const muted = st.getPropertyValue("--muted-foreground").trim() || "#888";
      const bg = st.getPropertyValue("--background").trim() || "#111";
      const R = radius(), cx = w / 2, cy = h / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // halo + sphere body
      ctx.save();
      ctx.globalAlpha = 0.18;
      const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.25);
      halo.addColorStop(0, gold); halo.addColorStop(1, "transparent");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = gold; ctx.fill(); ctx.restore();

      const p = proj();
      const path = geoPath(p, ctx);
      ctx.beginPath(); path(grat);
      ctx.save(); ctx.globalAlpha = 0.09; ctx.strokeStyle = gold; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore();

      // adaptive dot density: ~4.5px spacing on screen
      const want = (4 * Math.PI * R * R) / 20;
      const n = want < 50000 ? 40000 : want < 140000 ? 110000 : want < 320000 ? 260000 : 520000;
      const set = dotSet(n, feats);
      const lam = (c.lon * Math.PI) / 180, phi = (c.lat * Math.PI) / 180;
      const cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(phi), sp = Math.sin(phi);
      const dotPass = (arr: Float32Array, color: string, alpha: number, sz: number) => {
        ctx.fillStyle = color;
        for (let pass = 0; pass < 2; pass++) {
          ctx.globalAlpha = pass === 0 ? alpha * 0.45 : alpha;
          ctx.beginPath();
          for (let i = 0; i < arr.length; i += 4) {
            const cosLon = arr[i]!, sinLon = arr[i + 1]!, cosLat = arr[i + 2]!, sinLat = arr[i + 3]!;
            const x = cosLat * (cosLon * cl - sinLon * sl), y = cosLat * (sinLon * cl + cosLon * sl);
            const depth = x * cp - sinLat * sp;
            if (depth <= 0.02) continue;
            if ((depth < 0.35) !== (pass === 0)) continue;
            const sx = cx + R * y, sy = cy - R * (sinLat * cp + x * sp);
            if (sx < -2 || sy < -2 || sx > w + 2 || sy > h + 2) continue;
            const s = sz * (0.55 + 0.45 * depth);
            ctx.rect(sx - s / 2, sy - s / 2, s, s);
          }
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      dotPass(set.sea, muted, 0.22, 1.1);
      dotPass(set.land, gold, 0.85, 2.1);

      // highlighted countries
      const { sel, hov, mine: me } = hl.current;
      for (const [name, a] of [[me, 0.14], [sel, 0.26], [hov, 0.4]] as const) {
        if (!name) continue;
        const f = feats.find((x) => x.name === name);
        if (!f) continue;
        ctx.beginPath(); path(f.f);
        ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = gold; ctx.fill();
        ctx.globalAlpha = 0.7; ctx.strokeStyle = gold; ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore();
      }
      // small hubs
      for (const [name, ll] of Object.entries(DOTS)) {
        const lamP = ((ll[0] + c.lon) * Math.PI) / 180, phP = (ll[1] * Math.PI) / 180;
        const x = Math.cos(phP) * Math.cos(lamP), z = Math.sin(phP);
        if (x * cp - z * sp <= 0) continue;
        const pt = p(ll);
        if (!pt) continue;
        ctx.beginPath(); ctx.arc(pt[0], pt[1], name === hov || name === sel ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = gold; ctx.fill();
      }
      // limb shading for spherical depth
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      const shade = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
      shade.addColorStop(0, "transparent"); shade.addColorStop(0.75, "transparent"); shade.addColorStop(1, bg);
      ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = shade; ctx.fill(); ctx.restore();
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const c = cam.current;
      if (!drag.current && Math.abs(c.vx) > 0.01) { c.lon += c.vx * dt; c.vx *= Math.exp(-3.5 * dt); c.dirty = true; }
      else if (c.auto && !drag.current && !tween.current) { c.lon += 4 * dt; c.dirty = true; }
      if (c.dirty && visible) { c.dirty = false; draw(); }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feats]);

  const setK = (k: number) => {
    cam.current.k = clamp(k, 1, K_MAX);
    cam.current.dirty = true;
    setZoomed(cam.current.k > 1.01);
  };

  const flyTo = (lon: number, lat: number, k: number) => {
    tween.current?.stop();
    const c = cam.current;
    c.auto = false; c.vx = 0;
    const from = { lon: c.lon, lat: c.lat, k: c.k };
    let tl = -lon;
    tl = from.lon + ((((tl - from.lon) % 360) + 540) % 360) - 180;
    const to = { lon: tl, lat: clamp(-lat, -70, 70), k };
    const a = animate(0, 1, {
      duration: 1.1, ease: [0.16, 1, 0.3, 1],
      onUpdate: (t) => {
        c.lon = from.lon + (to.lon - from.lon) * t;
        c.lat = from.lat + (to.lat - from.lat) * t;
        c.k = from.k + (to.k - from.k) * t;
        c.dirty = true;
      },
      onComplete: () => { tween.current = null; setZoomed(c.k > 1.01); },
    });
    tween.current = { stop: () => { a.stop(); tween.current = null; } };
  };

  const focus = (name: string, zoom = true) => {
    const f = feats.find((x) => x.name === name);
    const ll = f ? geoCentroid(f.f) : DOTS[name];
    if (!ll) return;
    let k = cam.current.k;
    if (zoom) {
      const span = f ? Math.max(Math.abs(f.b[1][0] - f.b[0][0]) % 360, f.b[1][1] - f.b[0][1]) : 2;
      k = clamp(70 / Math.max(span, 1), 1.6, 6);
    }
    flyTo(ll[0], ll[1], k);
  };

  // Default to the user's country from their timezone (no permission prompt)
  useEffect(() => {
    try {
      const n = TZ[Intl.DateTimeFormat().resolvedOptions().timeZone];
      if (n) {
        setMine(n); setSelected(n);
        const f = feats.find((x) => x.name === n);
        const ll = f ? geoCentroid(f.f) : DOTS[n];
        if (ll) { cam.current.lon = -ll[0] - 25; cam.current.lat = clamp(-ll[1], -45, 45); cam.current.dirty = true; }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countryAt = (clientX: number, clientY: number): string | null => {
    const r = cvRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = clientX - r.left, y = clientY - r.top;
    const p = proj();
    for (const [name, ll] of Object.entries(DOTS)) {
      const pt = p(ll);
      if (pt && Math.hypot(pt[0] - x, pt[1] - y) < 10) {
        const lamP = ((ll[0] + cam.current.lon) * Math.PI) / 180, phP = (ll[1] * Math.PI) / 180, ph = (cam.current.lat * Math.PI) / 180;
        if (Math.cos(phP) * Math.cos(lamP) * Math.cos(ph) - Math.sin(phP) * Math.sin(ph) > 0) return name;
      }
    }
    if (Math.hypot(x - size.current.w / 2, y - size.current.h / 2) > radius()) return null;
    const ll = p.invert?.([x, y]);
    if (!ll) return null;
    const [lon, lat] = ll;
    for (const f of feats) {
      const [[x0, y0], [x1, y1]] = f.b;
      if (lat < y0 || lat > y1) continue;
      if (x0 <= x1 ? lon < x0 || lon > x1 : lon < x0 && lon > x1) continue;
      if (geoContains(f.f, ll)) return f.name;
    }
    return null;
  };

  // Wheel zoom (page still scrolls until zoomed, unless ctrl/alt pinch)
  useEffect(() => {
    const el = cvRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.altKey && cam.current.k <= 1.01) return;
      e.preventDefault();
      tween.current?.stop();
      cam.current.auto = false;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      setK(cam.current.k * Math.exp(-dy * 0.002));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const locate = () => {
    if (!navigator.geolocation) return setLocMsg("Location isn't available on this device.");
    setLocMsg("Finding you…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const ll: [number, number] = [coords.longitude, coords.latitude];
        const hit = feats.find((p) => geoContains(p.f, ll));
        const name = hit?.name ?? Object.entries(DOTS).find(([, p]) => Math.hypot(p[0] - ll[0], p[1] - ll[1]) < 1.5)?.[0];
        if (!name) return setLocMsg("Couldn't match your location to a country.");
        setMine(name);
        setSelected(name);
        focus(name);
        const c = lookup(name);
        if (c && c.currency !== cur) setSettings((s) => ({ ...s, baseCurrency: c.currency, baseRate: c.rate }));
        setLocMsg(null);
      },
      () => setLocMsg("Location permission was declined."),
      { timeout: 10000 },
    );
  };

  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.current.k };
      drag.current = null;
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, lon: cam.current.lon, lat: cam.current.lat, moved: false, t: performance.now(), lx: e.clientX };
  };
  const onMovePtr = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      tween.current?.stop();
      cam.current.auto = false;
      setHover(null);
      setK(pinch.current.k * (Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d));
      return;
    }
    const d = drag.current;
    if (!d) {
      if (e.pointerType === "mouse") {
        const name = countryAt(e.clientX, e.clientY);
        const c = name ? lookup(name) : null;
        const r = box.current!.getBoundingClientRect();
        setHover(c ? { c, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      }
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved && e.pointerType === "touch" && cam.current.k <= 1.01 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
    if (!d.moved) { try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {} tween.current?.stop(); }
    d.moved = true;
    setHover(null);
    const c = cam.current;
    c.auto = false;
    const degPerPx = 180 / (Math.PI * radius());
    c.lon = d.lon + dx * degPerPx;
    c.lat = clamp(d.lat - dy * degPerPx, -75, 75);
    const now = performance.now(), dtm = Math.max(now - d.t, 1);
    c.vx = ((e.clientX - d.lx) * degPerPx * 1000) / dtm;
    d.t = now; d.lx = e.clientX;
    c.dirty = true;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
    if (d && !d.moved) {
      cam.current.vx = 0;
      const name = countryAt(e.clientX, e.clientY);
      if (name && lookup(name)) {
        setSelected(name);
        focus(name);
        if (e.pointerType !== "mouse") {
          const r = box.current!.getBoundingClientRect();
          setHover(null);
          void r;
        }
      }
    } else if (d && performance.now() - d.t > 80) cam.current.vx = 0;
  };

  const g = hover ? landedPerGram(hover.c, spot, basis, 0.916) : 0;
  const g24 = hover ? landedPerGram(hover.c, spot, basis, 0.999) : 0;

  const ranked = useMemo(
    () => countries.map((c) => ({ c, v: landedPerGram(c, spot, basis, 0.916) })).sort((a, b) => a.v - b.v),
    [countries, spot, basis],
  );

  const btn = "grid h-10 w-10 place-items-center rounded-full border bg-background/80 text-foreground shadow-sm backdrop-blur transition active:scale-95 hover:border-gold hover:text-gold sm:h-9 sm:w-9";

  return (
    <div>
      <div ref={box} className="relative -mx-4 select-none sm:-mx-6" onMouseLeave={() => setHover(null)}>
        <div
          style={{
            WebkitMaskImage: "radial-gradient(ellipse 58% 54% at 50% 50%, #000 62%, transparent 100%)",
            maskImage: "radial-gradient(ellipse 58% 54% at 50% 50%, #000 62%, transparent 100%)",
          }}
        >
          <canvas ref={cvRef} className="block w-full" aria-label="Interactive gold price globe"
            style={{ touchAction: zoomed ? "none" : "pan-y", cursor: "grab", height: 420 }}
            onPointerDown={onDown} onPointerMove={onMovePtr} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>

        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0 sm:flex-col">
          <button className={btn} onClick={() => { tween.current?.stop(); cam.current.auto = false; setK(cam.current.k * 1.6); }} aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
          <button className={btn} onClick={() => { tween.current?.stop(); setK(cam.current.k / 1.6); }} aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
          <button className={btn} onClick={() => { const c = cam.current; flyTo(-c.lon, 12, 1); }} aria-label="Reset view"><RotateCcw className="h-3.5 w-3.5" /></button>
          <button className={btn} onClick={locate} aria-label="Use my location"><LocateFixed className="h-4 w-4" /></button>
        </div>

        {hover && (
          <div className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg border bg-popover/95 p-3 text-xs shadow-lg backdrop-blur"
            style={{ left: clamp(hover.x, 120, (box.current?.clientWidth ?? 240) - 120), top: hover.y }}>
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-popover-foreground">{hover.c.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{basis === "retail" ? "Shop" : "Raw"}</span>
            </div>
            {[["916 · 22K", g], ["999 · 24K", g24]].map(([l, v]) => (
              <div key={l as string} className="num mt-2">
                <div className="text-[10px] text-muted-foreground">{l} per gram</div>
                <div className="text-sm text-gold">{fmt((v as number) * hover.c.rate, hover.c.currency, 2)}</div>
                {hover.c.currency !== cur && <div className="text-[11px] text-muted-foreground">≈ {fmt((v as number) * base, cur, 2)}</div>}
              </div>
            ))}
            <div className="num mt-2 text-[10px] text-muted-foreground">1 paun (8 g 916) · {fmt(g * 8 * hover.c.rate, hover.c.currency, 0)}</div>
          </div>
        )}
      </div>

      <p className="mx-auto mt-2 min-h-4 max-w-[34rem] px-4 text-center text-[11px] leading-5 text-muted-foreground sm:text-xs">
        {locMsg ?? "Drag to spin the globe · pinch or + / − to zoom · tap a country"}
      </p>

      {(() => {
        const pick = (selected && lookup(selected)) || (mine && lookup(mine)) || countries.find((c) => c.currency === cur) || ranked[0]?.c;
        if (!pick) return null;
        const v = landedPerGram(pick, spot, basis, 0.916);
        return (
          <div className="mt-8 overflow-hidden px-1 text-center sm:mt-10">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs sm:tracking-[0.25em]">{pick.name} · 916 per gram · {basis === "retail" ? "shop price" : "raw metal"}</p>
            <div className={`num mt-3 whitespace-nowrap font-display text-gold md:text-7xl ${fmt(v * pick.rate, pick.currency, 2).length > 15 ? "text-3xl" : "text-4xl sm:text-5xl"}`}><Odometer key={pick.name} text={fmt(v * pick.rate, pick.currency, 2)} /></div>
            <p className="num mt-3 text-sm text-muted-foreground">
              1 paun · {fmt(v * 8 * pick.rate, pick.currency, 0)}{pick.currency !== cur && <> · ≈ {fmt(v * base, cur, 2)}/g</>}
            </p>
            <div className="num mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border min-[420px]:grid-cols-3 lg:grid-cols-6">
              {PURITIES.filter((p) => ["999.9", "999", "916", "875", "750", "585"].includes(p.id)).map((p) => {
                const pg = landedPerGram(pick, spot, basis, p.fineness / 1000);
                return (
                  <div key={p.id} className="bg-background px-3 py-3 text-left">
                    <div className="text-[11px] text-muted-foreground">{p.label}</div>
                    <div className="mt-0.5 text-sm">{fmt(pg * pick.rate, pick.currency, 2)}<span className="text-muted-foreground">/g</span></div>
                    {pick.currency !== cur && <div className="text-[10px] text-muted-foreground">≈ {fmt(pg * base, cur, 2)}</div>}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Prices for {pick.name} · tap any country to switch</p>
          </div>
        );
      })()}

      <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-5 min-[360px]:grid-cols-2 sm:mt-10 sm:grid-cols-3 lg:grid-cols-4">
        {ranked.map(({ c, v }, i) => (
          <button key={c.id} onClick={() => { setSelected(c.name); focus(c.name); }} className="group border-t pt-3 text-left">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate group-hover:text-gold">{c.name}</span>
              {i === 0 && <span className="text-[10px] uppercase tracking-wider text-success">Cheapest</span>}
            </div>
            <div className="num mt-1 text-lg text-gold"><CountUp value={v * c.rate} cur={c.currency} /></div>
            <div className="num text-[11px] text-muted-foreground">
              916 / g{c.currency !== cur && <> · ≈ <CountUp value={v * base} cur={cur} /></>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
