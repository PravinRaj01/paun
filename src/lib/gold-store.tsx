import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSnapshot } from "./forecast/snapshot";
import { DEFAULT_DOCK, normalizeDock, type DockId } from "./dock";
import { clearGeminiKey } from "./gemini-key";
import {
  baseRateOf,
  effectiveCountry,
  hasDefaultSpot,
  migrateVaultPaid,
  DEFAULT_COUNTRIES,
  DEFAULT_SETTINGS,
  DEFAULT_TRADE,
  type Country,
  type Settings,
  type Trade,
  type VaultItem,
} from "./gold";

const K = "gold-assistant:";

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(K + key);
      if (raw) setValue({ ...(initial as object), ...JSON.parse(raw) } as T);
      if (raw && Array.isArray(initial)) setValue(JSON.parse(raw));
    } catch {}
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (loaded) localStorage.setItem(K + key, JSON.stringify(value));
  }, [key, value, loaded]);
  return [value, setValue, loaded] as const;
}

type Store = {
  settings: Settings;
  setSettings: (s: Settings | ((p: Settings) => Settings)) => void;
  /** The watchlist as it should be READ: each rate is the market rate unless the person set their own. Never write this list back. */
  countries: Country[];
  /** The watchlist exactly as saved (and as it is synced). Edit through setCountries; read it for anything that is saved or sent. */
  rawCountries: Country[];
  setCountries: (c: Country[] | ((p: Country[]) => Country[])) => void;
  /** Exchange rates (local units per USD) and the market date of the daily snapshot, once it has loaded. */
  marketFx: { rates: Record<string, number>; asOf: string } | null;
  trade: Trade;
  setTrade: (t: Trade | ((p: Trade) => Trade)) => void;
  excluded: string[]; // country ids left out of the spread & arbitrage comparison
  setExcluded: (e: string[] | ((p: string[]) => string[])) => void;
  /** What sits in the dock and in what order (always valid; see src/lib/dock.ts). Kept on this device. */
  dock: DockId[];
  setDock: (d: DockId[] | ((p: DockId[]) => DockId[])) => void;
  vault: VaultItem[];
  setVault: (v: VaultItem[] | ((p: VaultItem[]) => VaultItem[])) => void;
  hydrated: boolean; // saved settings have been read from this browser (before that, defaults are shown)
  priceUnavailable: boolean; // neither the live file nor the bundled copy of the price data could be loaded
  theme: "dark" | "light";
  toggleTheme: () => void;
  resetAll: () => void;
};

// Keep one context instance across hot reloads so provider and consumers never mismatch.
const g = globalThis as { __paunGoldCtx?: React.Context<Store | null> };
const Ctx = (g.__paunGoldCtx ??= createContext<Store | null>(null));

export function GoldProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings, hydrated] = usePersisted("settings", DEFAULT_SETTINGS);
  const [priceUnavailable, setPriceUnavailable] = useState(false);
  const [rawCountries, setCountries, countriesLoaded] = usePersisted<Country[]>("countries", DEFAULT_COUNTRIES);
  const [marketFx, setMarketFx] = useState<{ rates: Record<string, number>; asOf: string } | null>(null);
  const countries = useMemo(
    () => rawCountries.map((c) => effectiveCountry(c, marketFx?.rates)),
    [rawCountries, marketFx],
  );
  const [trade, setTrade] = usePersisted("trade", DEFAULT_TRADE);
  const [excluded, setExcluded] = usePersisted<string[]>("excluded", []);
  const [vault, setVault, vaultLoaded] = usePersisted<VaultItem[]>("vault", []);
  const [dockSaved, setDock] = usePersisted<DockId[]>("dock", [...DEFAULT_DOCK]);
  const dock = useMemo(() => normalizeDock(dockSaved), [dockSaved]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Pieces saved before the price paid was kept in its own currency get it filled in once, from the rate the person had saved (not the
  // market one), so what they typed comes back as typed. Pieces that arrive later from an older device are handled the same way.
  useEffect(() => {
    if (!hydrated || !countriesLoaded || !vaultLoaded) return;
    const m = migrateVaultPaid(vault, {
      currency: settings.baseCurrency,
      ratePerUsd: baseRateOf(settings, rawCountries),
      now: new Date(),
    });
    if (m.changed) setVault(m.vault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, countriesLoaded, vaultLoaded, vault]);

  useEffect(() => {
    const t = localStorage.getItem(K + "theme");
    if (t === "light") setTheme("light");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    // the browser and the installed app's status bar follow the theme, not a fixed colour
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0e0c09" : "#f8f5ee");
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = settings.language === "ms" ? "ms" : "en";
  }, [settings.language]);

  // The shipped default spot is a stale placeholder. Users who never set a price (or chose to follow the market close)
  // get the latest published close; anyone who typed or fetched their own price is left alone.
  useEffect(() => {
    let alive = true;
    getSnapshot().then(
      ({ snapshot }) => {
        if (!alive) return;
        setPriceUnavailable(false);
        const close = snapshot.spotXauUsd;
        setSettings((s) =>
          (s.source === "market" || hasDefaultSpot(s)) && s.spotUsdOz !== close
            ? { ...s, spotUsdOz: close, source: "market", updatedAt: new Date().toISOString() }
            : s,
        );
      },
      () => alive && setPriceUnavailable(true), // offline or blocked: keep whatever the user has, and say so
    );
    return () => {
      alive = false;
    };
  }, []);

  const toggleTheme = () =>
    setTheme((t) => {
      const n = t === "dark" ? "light" : "dark";
      localStorage.setItem(K + "theme", n);
      return n;
    });

  const resetAll = () => {
    clearGeminiKey(); // the optional scanner key lives outside Settings, so reset must forget it too
    setSettings(DEFAULT_SETTINGS);
    setCountries(DEFAULT_COUNTRIES);
    setTrade(DEFAULT_TRADE);
    setExcluded([]);
    setDock([...DEFAULT_DOCK]);
  };

  return (
    <Ctx.Provider
      value={{ settings, setSettings, countries, rawCountries, setCountries, marketFx, trade, setTrade, excluded, setExcluded, dock, setDock, vault, setVault, hydrated, priceUnavailable, theme, toggleTheme, resetAll }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useGold() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useGold outside provider");
  return c;
}
