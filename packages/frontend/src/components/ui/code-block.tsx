import { useCallback, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/cn";

interface CodeBlockProps {
  /** Code content to display */
  children: string;
  /** Programming language label (displayed in header) */
  language?: string;
  /** Optional title shown in the header */
  title?: string;
  /** Additional CSS class */
  className?: string;
  /** Show line numbers (default true) */
  showLineNumbers?: boolean;
  /** Max height before scrolling (default "24rem") */
  maxHeight?: string;
}

/**
 * Styled code block with copy-to-clipboard, optional line numbers, and a language label.
 * Does not include syntax highlighting to avoid a heavy dependency —
 * a future enhancement can layer Prism or Shiki on top.
 */
export function CodeBlock({
  children,
  language,
  title,
  className,
  showLineNumbers = true,
  maxHeight = "24rem",
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  const lines = children.split("\n");
  // Remove trailing empty line that often comes from template literals
  if (lines.length > 1 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return (
    <div className={cn("rounded-lg border border-[hsl(var(--border))] overflow-hidden", className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-3))] px-3 py-1.5">
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
          {title ?? language ?? "Code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code area */}
      <div
        className="overflow-auto bg-[hsl(var(--card))]"
        style={{ maxHeight }}
      >
        <pre className="p-3 text-sm leading-relaxed">
          <code>
            {lines.map((line, i) => (
              <span key={i} className="table-row">
                {showLineNumbers && (
                  <span className="table-cell select-none pr-4 text-right text-xs text-[hsl(var(--muted-foreground))] opacity-50">
                    {i + 1}
                  </span>
                )}
                <span className="table-cell">{line || " "}</span>
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** Inline code span for within prose content */
export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-sm font-medium",
        className,
      )}
    >
      {children}
    </code>
  );
}
