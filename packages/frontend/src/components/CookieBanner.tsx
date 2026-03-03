import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Cookie } from "lucide-react";
import { Button } from "./ui/button";

const CONSENT_KEY = "cookie_consent";

export type CookieConsent = "all" | "essential";

export function getCookieConsent(): CookieConsent | null {
  const value = localStorage.getItem(CONSENT_KEY);
  if (value === "all" || value === "essential") {
    return value;
  }
  return null;
}

export function CookieBanner() {
  const { t } = useTranslation("common");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getCookieConsent() === null);
  }, []);

  const accept = useCallback((choice: CookieConsent) => {
    localStorage.setItem(CONSENT_KEY, choice);
    setVisible(false);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 shadow-lg">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--primary))]" />
          <div>
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">{t("cookieBanner.title")}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {t("cookieBanner.description")}{" "}
              <Link className="text-[hsl(var(--primary))] underline" to="/privacy">
                {t("cookieBanner.learnMore")}
              </Link>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => accept("essential")}>
            {t("cookieBanner.essentialOnly")}
          </Button>
          <Button size="sm" onClick={() => accept("all")}>
            {t("cookieBanner.acceptAll")}
          </Button>
        </div>
      </div>
    </div>
  );
}
