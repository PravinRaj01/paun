import type React from "react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
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
  return [value, setValue] as const;
}

type Store = {
  settings: Settings;
  setSettings: (s: Settings | ((p: Settings) => Settings)) => void;
  countries: Country[];
  setCountries: (c: Country[] | ((p: Country[]) => Country[])) => void;
  trade: Trade;
  setTrade: (t: Trade | ((p: Trade) => Trade)) => void;
  excluded: string[]; // country ids left out of the spread & arbitrage comparison
  setExcluded: (e: string[] | ((p: string[]) => string[])) => void;
  vault: VaultItem[];
  setVault: (v: VaultItem[] | ((p: VaultItem[]) => VaultItem[])) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  resetAll: () => void;
};

// Keep one context instance across hot reloads so provider and consumers never mismatch.
const g = globalThis as { __paunGoldCtx?: React.Context<Store | null> };
const Ctx = (g.__paunGoldCtx ??= createContext<Store | null>(null));

export function GoldProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = usePersisted("settings", DEFAULT_SETTINGS);
  const [countries, setCountries] = usePersisted<Country[]>("countries", DEFAULT_COUNTRIES);
  const [trade, setTrade] = usePersisted("trade", DEFAULT_TRADE);
  const [excluded, setExcluded] = usePersisted<string[]>("excluded", []);
  const [vault, setVault] = usePersisted<VaultItem[]>("vault", []);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = localStorage.getItem(K + "theme");
    if (t === "light") setTheme("light");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = settings.language === "ms" ? "ms" : "en";
  }, [settings.language]);

  const toggleTheme = () =>
    setTheme((t) => {
      const n = t === "dark" ? "light" : "dark";
      localStorage.setItem(K + "theme", n);
      return n;
    });

  const resetAll = () => {
    setSettings(DEFAULT_SETTINGS);
    setCountries(DEFAULT_COUNTRIES);
    setTrade(DEFAULT_TRADE);
    setExcluded([]);
  };

  return (
    <Ctx.Provider
      value={{ settings, setSettings, countries, setCountries, trade, setTrade, excluded, setExcluded, vault, setVault, theme, toggleTheme, resetAll }}
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
