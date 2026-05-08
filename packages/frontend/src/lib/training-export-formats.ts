export type ExportFormatId = "openai-multitask" | "sharegpt-codegen" | "alpaca-codegen";

export interface ExportFormat {
  id: ExportFormatId;
  label: string;
  description: string;
  filename: string;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "openai-multitask",
    label: "OpenAI multi-task (combined)",
    description: "Agent tool-use + spec-gen + enrichment combined; OpenAI messages format with metadata.",
    filename: "training-data-combined.jsonl",
  },
  {
    id: "sharegpt-codegen",
    label: "ShareGPT — codegen only",
    description: "Single-turn ShareGPT (from/value). Matches dgx-manager-fine-tune-recipes.",
    filename: "training-data-sharegpt-codegen.jsonl",
  },
  {
    id: "alpaca-codegen",
    label: "Alpaca — codegen only",
    description: "Flat instruction/input/output. Simplest format.",
    filename: "training-data-alpaca-codegen.jsonl",
  },
];
