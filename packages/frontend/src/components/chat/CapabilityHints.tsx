import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle, X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ */
/*  Capability data                                                    */
/* ------------------------------------------------------------------ */

interface CapabilityCategory {
  nameKey: string;
  examplesKey: string;
}

const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  { nameKey: "pages:chat.capabilities.gears", examplesKey: "pages:chat.capabilities.gearsExamples" },
  { nameKey: "pages:chat.capabilities.brackets", examplesKey: "pages:chat.capabilities.bracketsExamples" },
  { nameKey: "pages:chat.capabilities.enclosures", examplesKey: "pages:chat.capabilities.enclosuresExamples" },
  { nameKey: "pages:chat.capabilities.adapters", examplesKey: "pages:chat.capabilities.adaptersExamples" },
  { nameKey: "pages:chat.capabilities.mechanical", examplesKey: "pages:chat.capabilities.mechanicalExamples" },
];

interface KnownLimitation {
  textKey: string;
}

const KNOWN_LIMITATIONS: KnownLimitation[] = [
  { textKey: "pages:chat.limitations.organic" },
  { textKey: "pages:chat.limitations.threads" },
  { textKey: "pages:chat.limitations.assemblies" },
];

/* ------------------------------------------------------------------ */
/*  CapabilityHints component                                          */
/* ------------------------------------------------------------------ */

export interface CapabilityHintsProps {
  className?: string;
}

export function CapabilityHints({ className }: CapabilityHintsProps) {
  const { t } = useTranslation(["pages", "common"]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /* Close on Escape key */
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  /* Close on click outside */
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className={cn("relative inline-block", className)} data-testid="capability-hints">
      {/* Trigger button */}
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-label={t("pages:chat.whatCanIBuild")}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((prev) => !prev)}
        iconLeft={<HelpCircle className="h-3.5 w-3.5" />}
      >
        {t("pages:chat.whatCanIBuild")}
      </Button>

      {/* Popover panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("pages:chat.whatCanIBuild")}
          className={cn(
            "absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 shadow-[var(--elevation-3)]",
            "animate-scale-in",
          )}
        >
          {/* Header with close button */}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
              {t("pages:chat.whatCanIBuild")}
            </h3>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="rounded-md p-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              aria-label={t("common:a11y.closeCapabilityHints")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Supported part types */}
          <div className="space-y-2">
            {CAPABILITY_CATEGORIES.map((cat) => (
              <div key={cat.nameKey}>
                <p className="text-xs font-medium text-[hsl(var(--foreground))]">
                  {t(cat.nameKey)}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {t(cat.examplesKey)}
                </p>
              </div>
            ))}
          </div>

          {/* Known limitations */}
          <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
            <p className="mb-1 text-xs font-medium text-[hsl(var(--warning))]">
              {t("pages:chat.limitations.title")}
            </p>
            <ul className="space-y-1">
              {KNOWN_LIMITATIONS.map((lim) => (
                <li
                  key={lim.textKey}
                  className="text-xs text-[hsl(var(--muted-foreground))]"
                >
                  • {t(lim.textKey)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
