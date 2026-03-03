import i18next, { type i18n } from "i18next";
import FsBackend from "i18next-fs-backend";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const supportedLanguages = ["en", "de"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

let i18nInstance: i18n | null = null;

export async function initializeI18n(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localesPath = path.resolve(__dirname, "..", "locales");

  i18nInstance = i18next.createInstance();

  await i18nInstance.use(FsBackend).init({
    supportedLngs: supportedLanguages,
    fallbackLng: "en",
    preload: [...supportedLanguages],
    ns: ["errors", "validation"],
    defaultNS: "errors",
    backend: {
      loadPath: path.join(localesPath, "{{lng}}", "{{ns}}.json"),
    },
    interpolation: {
      escapeValue: false,
    },
  });
}

export function getI18n(): i18n {
  if (!i18nInstance) {
    throw new Error("i18n not initialized. Call initializeI18n() first.");
  }
  return i18nInstance;
}

export function tryGetI18n(): i18n | null {
  return i18nInstance;
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (supportedLanguages as readonly string[]).includes(lang);
}
