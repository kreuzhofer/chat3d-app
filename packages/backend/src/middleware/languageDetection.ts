import type { Request, Response, NextFunction } from "express";
import { tryGetI18n, isSupportedLanguage, type SupportedLanguage } from "../i18n/config.js";

declare global {
  namespace Express {
    interface Request {
      language: SupportedLanguage;
      t: (key: string, options?: Record<string, unknown>) => string;
    }
  }
}

function parseAcceptLanguage(header: string | undefined): SupportedLanguage | null {
  if (!header) return null;

  const languages = header
    .split(",")
    .map((part) => {
      const [lang, qPart] = part.trim().split(";");
      const q = qPart ? parseFloat(qPart.replace("q=", "")) : 1;
      return { lang: lang.trim().split("-")[0].toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of languages) {
    if (isSupportedLanguage(lang)) {
      return lang;
    }
  }

  return null;
}

export function languageDetection(req: Request, _res: Response, next: NextFunction): void {
  // Priority: (1) query param, (2) Accept-Language header, (3) fallback 'en'
  const queryLang = typeof req.query.lang === "string" ? req.query.lang.toLowerCase() : null;

  let language: SupportedLanguage = "en";

  if (queryLang && isSupportedLanguage(queryLang)) {
    language = queryLang;
  } else {
    const headerLang = parseAcceptLanguage(req.headers["accept-language"]);
    if (headerLang) {
      language = headerLang;
    }
  }

  req.language = language;

  const i18n = tryGetI18n();
  if (i18n) {
    req.t = (key: string, options?: Record<string, unknown>) => {
      return i18n.t(key, { lng: language, ...options }) as string;
    };
  } else {
    // Fallback when i18n is not initialized (e.g. in tests): return the key itself
    req.t = (key: string) => key;
  }

  next();
}
