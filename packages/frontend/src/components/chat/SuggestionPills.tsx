import { Lightbulb } from "lucide-react";

export interface SuggestionPillsProps {
  suggestions: string[];
  onSelectSuggestion: (prompt: string) => void;
}

export function SuggestionPills({ suggestions, onSelectSuggestion }: SuggestionPillsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
        <Lightbulb className="h-3 w-3" />
        Try one of these:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            className="inline-flex items-center rounded-full border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.06)] px-3 py-1 text-xs text-[hsl(var(--primary))] transition hover:border-[hsl(var(--primary)_/_0.6)] hover:bg-[hsl(var(--primary)_/_0.12)]"
            onClick={(e) => {
              e.stopPropagation();
              onSelectSuggestion(text);
            }}
          >
            {text.length > 80 ? `${text.slice(0, 77)}...` : text}
          </button>
        ))}
      </div>
    </div>
  );
}
