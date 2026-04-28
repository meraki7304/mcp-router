import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhTranslation from "../locales/zh.json";

void i18n.use(initReactI18next).init({
  resources: {
    zh: {
      translation: zhTranslation,
    },
  },
  lng: "zh",
  fallbackLng: "zh",
  ns: ["translation"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false, // React already safes from XSS
  },
  // Allow returning objects from translation keys
  returnObjects: true,
  react: {
    useSuspense: true,
  },
});

export default i18n;
