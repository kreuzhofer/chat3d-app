import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import { cn } from "../../lib/cn";
import { getStarterPrompts, type StarterPrompt } from "../../api/public.api";
import { Skeleton } from "../ui/skeleton";

/* ------------------------------------------------------------------ */
/*  Hardcoded fallback prompts (used when gallery has no models)       */
/* ------------------------------------------------------------------ */

interface FallbackEntry {
  labelKey: string;
  promptKey: string;
}

const FALLBACK_PROMPTS: FallbackEntry[] = [
  { labelKey: "pages:chat.examplePrompts.spurGear", promptKey: "pages:chat.examplePrompts.spurGearPrompt" },
  { labelKey: "pages:chat.examplePrompts.piEnclosure", promptKey: "pages:chat.examplePrompts.piEnclosurePrompt" },
  { labelKey: "pages:chat.examplePrompts.lBracket", promptKey: "pages:chat.examplePrompts.lBracketPrompt" },
  { labelKey: "pages:chat.examplePrompts.hoseAdapter", promptKey: "pages:chat.examplePrompts.hoseAdapterPrompt" },
];

/* ------------------------------------------------------------------ */
/*  ExamplePrompts component                                           */
/* ------------------------------------------------------------------ */

export interface ExamplePromptsProps {
  onSelectPrompt: (promptText: string) => void;
}

export function ExamplePrompts({ onSelectPrompt }: ExamplePromptsProps) {
  const { t } = useTranslation(["pages", "common"]);
  const [galleryPrompts, setGalleryPrompts] = useState<StarterPrompt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getStarterPrompts(4)
      .then((prompts) => {
        if (!cancelled) setGalleryPrompts(prompts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const useGallery = galleryPrompts.length > 0;

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4" data-testid="example-prompts">
      <div className="flex items-start gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <Lightbulb
          className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]"
          aria-hidden="true"
        />
        <p>{t("pages:chat.capabilityDescription")}</p>
      </div>

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="list"
        aria-label={t("common:a11y.examplePrompts")}
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3">
              <Skeleton className="mb-2 h-20 w-full rounded" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))
        ) : useGallery ? (
          galleryPrompts.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              onClick={() => onSelectPrompt(entry.promptText)}
              className={cn(
                "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-left text-sm transition overflow-hidden",
                "hover:border-[hsl(var(--primary)_/_0.5)] hover:bg-[hsl(var(--muted)_/_0.5)]",
                "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1",
              )}
            >
              <img
                src={entry.screenshotUrl}
                alt=""
                className="h-24 w-full object-cover bg-[hsl(var(--muted))]"
                loading="lazy"
              />
              <div className="p-3">
                <span className="mb-0.5 block text-xs font-medium text-[hsl(var(--primary))]">
                  {entry.categoryName}
                </span>
                <span className="line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                  {entry.promptText}
                </span>
              </div>
            </button>
          ))
        ) : (
          FALLBACK_PROMPTS.map((entry) => (
            <button
              key={entry.labelKey}
              type="button"
              role="listitem"
              onClick={() => onSelectPrompt(t(entry.promptKey))}
              className={cn(
                "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 text-left text-sm transition",
                "hover:border-[hsl(var(--primary)_/_0.5)] hover:bg-[hsl(var(--muted)_/_0.5)]",
                "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1",
              )}
            >
              <span className="mb-1 block font-medium text-[hsl(var(--foreground))]">
                {t(entry.labelKey)}
              </span>
              <span className="line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                {t(entry.promptKey)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
