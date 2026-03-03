import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ */
/*  Example prompt data                                                */
/* ------------------------------------------------------------------ */

export interface ExamplePromptEntry {
  /** Translation key for the short label displayed on the card. */
  labelKey: string;
  /** Translation key for the full prompt text populated into the composer on click. */
  promptKey: string;
}

const EXAMPLE_PROMPTS: ExamplePromptEntry[] = [
  { labelKey: "pages:chat.examplePrompts.spurGear", promptKey: "pages:chat.examplePrompts.spurGearPrompt" },
  { labelKey: "pages:chat.examplePrompts.piEnclosure", promptKey: "pages:chat.examplePrompts.piEnclosurePrompt" },
  { labelKey: "pages:chat.examplePrompts.lBracket", promptKey: "pages:chat.examplePrompts.lBracketPrompt" },
  { labelKey: "pages:chat.examplePrompts.hoseAdapter", promptKey: "pages:chat.examplePrompts.hoseAdapterPrompt" },
];

/* ------------------------------------------------------------------ */
/*  ExamplePrompts component                                           */
/* ------------------------------------------------------------------ */

export interface ExamplePromptsProps {
  /** Callback invoked with the full prompt text when a card is clicked. */
  onSelectPrompt: (promptText: string) => void;
}

export function ExamplePrompts({ onSelectPrompt }: ExamplePromptsProps) {
  const { t } = useTranslation(["pages", "common"]);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4" data-testid="example-prompts">
      {/* Capability description */}
      <div className="flex items-start gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <Lightbulb
          className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]"
          aria-hidden="true"
        />
        <p>{t("pages:chat.capabilityDescription")}</p>
      </div>

      {/* Prompt cards */}
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="list"
        aria-label={t("common:a11y.examplePrompts")}
      >
        {EXAMPLE_PROMPTS.map((entry) => (
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
        ))}
      </div>
    </div>
  );
}
