import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useGold } from "./gold-store";
import en from "../locales/en.json";
import ms from "../locales/ms.json";

export type Language = "en" | "ms";
export type CopyKey = keyof typeof en;

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources: { en: { translation: en }, ms: { translation: ms } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    initAsync: false,
  });
}

export function useI18n() {
  const { settings, setSettings } = useGold();
  const language: Language = settings.language ?? "en";
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
  return {
    language,
    t: (key: CopyKey) => t(key, { lng: language }),
    setLanguage: (next: Language) => setSettings((s) => ({ ...s, language: next })),
  };
}
