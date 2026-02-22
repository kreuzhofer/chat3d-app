import { useState, useCallback, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface CollapsibleSectionProps {
  /** Header text displayed on the toggle control. */
  title: string;
  /** Content revealed when expanded. */
  children?: ReactNode;
  /** Initial expanded state. Defaults to `false` (collapsed). */
  defaultExpanded?: boolean;
}

/**
 * Expand/collapse wrapper for code and file details.
 * Collapsed by default with accessible keyboard activation (Enter, Space)
 * and `aria-expanded` on the toggle control.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */
export function CollapsibleSection({
  title,
  children,
  defaultExpanded = false,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="rounded-md border border-[hsl(var(--border)_/_0.4)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted)_/_0.5)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        />
        <span>{title}</span>
      </button>

      {expanded ? (
        <div className="border-t border-[hsl(var(--border)_/_0.4)] px-3 py-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
