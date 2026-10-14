import { useEffect } from "react";
import { baseRateOf, clearTradeMoney, convertTradeMoney, currencyLabel, fmt, rateKnown } from "@/lib/gold";
import { useGold } from "@/lib/gold-store";

/**
 * What every tab of the price check needs: the market gold price, the exchange rate to the display currency, a money formatter,
 * and (as a side effect) the typed amounts restated whenever the display currency changes, so "RM 532.22" never silently
 * becomes "USD 532.22".
 */
export function useCheck() {
  const { settings, countries, trade, setTrade, hydrated } = useGold();
  const cur = settings.baseCurrency;
  const fx = baseRateOf(settings, countries);
  const oldCurrency = trade.currency;

  useEffect(() => {
    if (oldCurrency === cur) return;
    setTrade((t) => {
      if (t.currency === cur) return t;
      if (!rateKnown(t.currency, settings, countries)) return clearTradeMoney(t, cur);
      return convertTradeMoney(t, baseRateOf({ ...settings, baseCurrency: t.currency }, countries), fx, cur);
    });
    // only when the display currency changes: the rates themselves moving must not rewrite what the person typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, oldCurrency]);

  return {
    usdPerOz: settings.spotUsdOz,
    fx,
    cur,
    curLabel: currencyLabel(cur),
    hydrated,
    decimals: settings.decimals,
    money: (n: number) => fmt(n, cur, settings.decimals),
    trade,
    setTrade,
  };
}
