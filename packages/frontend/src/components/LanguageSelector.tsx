import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { supportedLanguages, languageNames, type SupportedLanguage } from "../i18n/config";
import { updateLanguage } from "../api/profile.api";
import { useAuth } from "../hooks/useAuth";

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleLanguageChange(lng: SupportedLanguage) {
    void i18n.changeLanguage(lng);
    setOpen(false);

    if (token) {
      void updateLanguage(token, lng);
    }
  }

  const currentLang = (supportedLanguages as readonly string[]).includes(i18n.language)
    ? (i18n.language as SupportedLanguage)
    : "en";

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        className="flex items-center gap-1.5 rounded-md p-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={languageNames[currentLang]}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline">{languageNames[currentLang]}</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] py-1 shadow-[var(--elevation-2)]"
        >
          {supportedLanguages.map((lng) => (
            <button
              key={lng}
              type="button"
              role="menuitem"
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition hover:bg-[hsl(var(--muted))] ${
                currentLang === lng
                  ? "font-medium text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--foreground))]"
              }`}
              onClick={() => handleLanguageChange(lng)}
            >
              {languageNames[lng]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
