import { forwardRef, useCallback, useEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** When true, the textarea auto-resizes to fit content (up to maxRows). */
  autoResize?: boolean;
  /** Maximum visible rows when autoResize is enabled. Default 8. */
  maxRows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoResize, maxRows = 8, onChange, ...props },
  forwardedRef,
) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const resize = useCallback(() => {
    const el = internalRef.current;
    if (!el || !autoResize) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const maxHeight = lineHeight * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [autoResize, maxRows]);

  // Resize on value changes (controlled component)
  useEffect(() => {
    resize();
  }, [props.value, resize]);

  return (
    <textarea
      ref={setRefs}
      className={cn(
        "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 text-base text-[hsl(var(--foreground))] outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:ring-2 focus:ring-[hsl(var(--primary))]",
        !autoResize && "min-h-[100px]",
        className,
      )}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      {...props}
    />
  );
});
