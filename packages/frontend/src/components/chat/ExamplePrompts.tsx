import { Lightbulb } from "lucide-react";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ */
/*  Example prompt data                                                */
/* ------------------------------------------------------------------ */

export interface ExamplePromptEntry {
  /** Short label displayed on the card. */
  label: string;
  /** Full prompt text populated into the composer on click. */
  prompt: string;
}

const EXAMPLE_PROMPTS: ExamplePromptEntry[] = [
  {
    label: "Spur gear",
    prompt:
      "Design a spur gear with 20 teeth, a module of 2mm, and a 5mm center bore.",
  },
  {
    label: "Raspberry Pi enclosure",
    prompt:
      "Create a simple snap-fit enclosure for a Raspberry Pi 4, with ventilation slots and mounting holes.",
  },
  {
    label: "L-bracket",
    prompt:
      "Generate an L-shaped mounting bracket, 50mm × 30mm with 3mm thickness and four M4 bolt holes.",
  },
  {
    label: "Hose adapter",
    prompt:
      "Design a stepped hose adapter that transitions from 12mm inner diameter to 8mm, 40mm long with barbed ridges.",
  },
];

/* ------------------------------------------------------------------ */
/*  ExamplePrompts component                                           */
/* ------------------------------------------------------------------ */

export interface ExamplePromptsProps {
  /** Callback invoked with the full prompt text when a card is clicked. */
  onSelectPrompt: (promptText: string) => void;
}

/**
 * Clickable example prompt cards displayed in the empty chat state.
 * Covers diverse CAD use cases: gears, enclosures, brackets, adapters.
 * Includes a brief capability description.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */
export function ExamplePrompts({ onSelectPrompt }: ExamplePromptsProps) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-4" data-testid="example-prompts">
      {/* Capability description */}
      <div className="flex items-start gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <Lightbulb
          className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]"
          aria-hidden="true"
        />
        <p>
          Chat3D can generate gears, enclosures, brackets, adapters, and other
          mechanical parts from a text description. Pick an example or write your
          own prompt to get started.
        </p>
      </div>

      {/* Prompt cards */}
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="list"
        aria-label="Example prompts"
      >
        {EXAMPLE_PROMPTS.map((entry) => (
          <button
            key={entry.label}
            type="button"
            role="listitem"
            onClick={() => onSelectPrompt(entry.prompt)}
            className={cn(
              "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 text-left text-sm transition",
              "hover:border-[hsl(var(--primary)_/_0.5)] hover:bg-[hsl(var(--muted)_/_0.5)]",
              "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1",
            )}
          >
            <span className="mb-1 block font-medium text-[hsl(var(--foreground))]">
              {entry.label}
            </span>
            <span className="line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
              {entry.prompt}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
