import { useEffect, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ */
/*  Capability data                                                    */
/* ------------------------------------------------------------------ */

export interface CapabilityCategory {
  name: string;
  examples: string[];
}

export interface KnownLimitation {
  text: string;
}

const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  {
    name: "Gears",
    examples: ["Spur gears", "Bevel gears", "Module 1–5mm, 10–80 teeth"],
  },
  {
    name: "Brackets & Mounts",
    examples: ["L-brackets", "U-brackets", "Wall mounts", "Up to 200mm spans"],
  },
  {
    name: "Enclosures",
    examples: ["Raspberry Pi cases", "Sensor housings", "Snap-fit or screw-mount"],
  },
  {
    name: "Adapters & Fittings",
    examples: ["Hose adapters", "Pipe reducers", "6–50mm diameters"],
  },
  {
    name: "Mechanical Components",
    examples: ["Spacers", "Bushings", "Flanges", "Pulleys"],
  },
];

const KNOWN_LIMITATIONS: KnownLimitation[] = [
  { text: "Complex organic shapes (e.g. figurines) are not well supported." },
  { text: "Thread generation may require manual refinement." },
  { text: "Assemblies with multiple moving parts are not yet supported." },
];

/* ------------------------------------------------------------------ */
/*  CapabilityHints component                                          */
/* ------------------------------------------------------------------ */

export interface CapabilityHintsProps {
  /** Optional additional CSS class for the trigger wrapper. */
  className?: string;
}

/**
 * "What can I build?" help trigger that opens a dismissible popover
 * listing supported part types, example dimensions, and known limitations.
 *
 * Dismissible via: close button, Escape key, or clicking outside.
 * Does not interfere with the prompt input flow.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4
 */
export function CapabilityHints({ className }: CapabilityHintsProps) {
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
        aria-label="What can I build?"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((prev) => !prev)}
        iconLeft={<HelpCircle className="h-3.5 w-3.5" />}
      >
        What can I build?
      </Button>

      {/* Popover panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Capability hints"
          className={cn(
            "absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 shadow-[var(--elevation-3)]",
            "animate-scale-in",
          )}
        >
          {/* Header with close button */}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
              What can I build?
            </h3>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="rounded-md p-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              aria-label="Close capability hints"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Supported part types */}
          <div className="space-y-2">
            {CAPABILITY_CATEGORIES.map((cat) => (
              <div key={cat.name}>
                <p className="text-xs font-medium text-[hsl(var(--foreground))]">
                  {cat.name}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {cat.examples.join(" · ")}
                </p>
              </div>
            ))}
          </div>

          {/* Known limitations */}
          <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
            <p className="mb-1 text-xs font-medium text-[hsl(var(--warning))]">
              Known limitations
            </p>
            <ul className="space-y-1">
              {KNOWN_LIMITATIONS.map((lim) => (
                <li
                  key={lim.text}
                  className="text-xs text-[hsl(var(--muted-foreground))]"
                >
                  • {lim.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
