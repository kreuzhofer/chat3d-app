import type { ExportFormatId, FormatDefinition } from "./types.js";

const formats: FormatDefinition[] = [];

export function registerFormat(def: FormatDefinition): void {
  if (formats.some((f) => f.id === def.id)) {
    throw new Error(`Format already registered: ${def.id}`);
  }
  formats.push(def);
}

export function listFormats(): readonly FormatDefinition[] {
  return formats;
}

export function getFormat(id: ExportFormatId): FormatDefinition | undefined {
  return formats.find((f) => f.id === id);
}

// Placeholder registration so the registry is non-empty for tests and the
// real exporter is wired in Task 5.
registerFormat({
  id: "openai-multitask",
  label: "OpenAI multi-task (combined)",
  description: "Placeholder — replaced in Task 5",
  filename: "training-data-combined.jsonl",
  exporter: async () => "",
});
