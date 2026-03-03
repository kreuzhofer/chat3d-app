import { useCallback, useMemo, useState } from "react";
import { cn } from "../../lib/cn";

export interface ParameterSliderProps {
  name: string;
  displayName: string;
  description?: string | null;
  originalValue: number;
  value: number;
  onChange: (value: number) => void;
}

function humanize(snakeCase: string): string {
  return snakeCase
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ParameterSlider({
  name,
  displayName,
  description,
  originalValue,
  value,
  onChange,
}: ParameterSliderProps) {
  const [inputText, setInputText] = useState(String(value));

  // Stable slider range based only on originalValue.
  // Step is computed so the slider always has ~100–200 discrete positions,
  // giving consistent precision regardless of value magnitude.
  const { min, max, step } = useMemo(() => {
    const absOrig = Math.abs(originalValue);
    const rangeMax = Math.max(absOrig * 2, 1);
    const rangeMin = originalValue < 0 ? -rangeMax : 0;
    const range = rangeMax - rangeMin;
    const rawStep = range / 200;
    // Round to a "nice" number (1, 2, or 5 × power of 10)
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let niceMultiplier: number;
    if (normalized <= 1.5) niceMultiplier = 1;
    else if (normalized <= 3.5) niceMultiplier = 2;
    else if (normalized <= 7.5) niceMultiplier = 5;
    else niceMultiplier = 10;
    const rangeStep = niceMultiplier * magnitude;
    return { min: rangeMin, max: rangeMax, step: rangeStep };
  }, [originalValue]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const numValue = Number(e.target.value);
      onChange(numValue);
      setInputText(String(numValue));
    },
    [onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
    },
    [],
  );

  const handleInputBlur = useCallback(() => {
    const parsed = Number(inputText);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      onChange(parsed);
      setInputText(String(parsed));
    } else {
      setInputText(String(value));
    }
  }, [inputText, onChange, value]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
    },
    [],
  );

  const isModified = value !== originalValue;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`param-${name}`}
          className={cn(
            "text-xs font-medium",
            isModified ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]",
          )}
        >
          {displayName || humanize(name)}
        </label>
        {isModified ? (
          <button
            type="button"
            className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition"
            onClick={() => {
              onChange(originalValue);
              setInputText(String(originalValue));
            }}
            title="Reset to original value"
          >
            reset
          </button>
        ) : null}
      </div>
      {description ? (
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">{description}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          id={`param-input-${name}`}
          type="text"
          inputMode="decimal"
          value={inputText}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          className={cn(
            "h-7 w-16 shrink-0 rounded border px-1.5 text-xs text-center outline-none transition",
            "border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))]",
            "focus:ring-1 focus:ring-[hsl(var(--primary))]",
          )}
        />
        <input
          id={`param-${name}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[hsl(var(--muted))] accent-[hsl(var(--primary))]"
        />
      </div>
    </div>
  );
}

export interface ParameterSliderGroupProps {
  parameters: Array<{
    name: string;
    value: number;
    description: string | null;
  }>;
  tweakedValues: Record<string, number>;
  onChange: (name: string, value: number) => void;
}

export function ParameterSliderGroup({
  parameters,
  tweakedValues,
  onChange,
}: ParameterSliderGroupProps) {
  if (parameters.length === 0) return null;

  return (
    <div className="space-y-3">
      {parameters.map((param) => (
        <ParameterSlider
          key={param.name}
          name={param.name}
          displayName={param.name
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")}
          description={param.description}
          originalValue={param.value}
          value={tweakedValues[param.name] ?? param.value}
          onChange={(newValue) => onChange(param.name, newValue)}
        />
      ))}
    </div>
  );
}
