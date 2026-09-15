import { exportOpenAiMultiTaskJsonl } from "./openai-multitask.exporter.js";
import { exportShareGptCodegenJsonl } from "./sharegpt-codegen.exporter.js";
import { exportAlpacaCodegenJsonl } from "./alpaca-codegen.exporter.js";
import { exportJudgeSftJsonl } from "./judge-sft.exporter.js";
import type { ExportFormatId, FormatDefinition } from "./types.js";

const formats: FormatDefinition[] = [
  {
    id: "openai-multitask",
    label: "OpenAI multi-task (combined)",
    description:
      "Combined agent tool-use + spec-generation + spec-enrichment with task_type discriminator. OpenAI messages format with rich metadata. Backward-compatible default.",
    filename: "training-data-combined.jsonl",
    exporter: exportOpenAiMultiTaskJsonl,
  },
  {
    id: "sharegpt-codegen",
    label: "ShareGPT — codegen only",
    description:
      "Single-turn prompt → final code. {conversations: [{from, value}]}. Matches dataset_format: sharegpt in dgx-manager-fine-tune-recipes.",
    filename: "training-data-sharegpt-codegen.jsonl",
    exporter: exportShareGptCodegenJsonl,
  },
  {
    id: "alpaca-codegen",
    label: "Alpaca — codegen only",
    description:
      "Single-turn flat {instruction, input, output}. Simplest format; system prompt placed in `input`.",
    filename: "training-data-alpaca-codegen.jsonl",
    exporter: exportAlpacaCodegenJsonl,
  },
  {
    id: "judge-sft",
    label: "Judge SFT — item verdicts with evidence",
    description:
      "The visual judge's fine-tuning set (#94): OpenAI chat format, the eight views as image parts by relative path, the labelled items' verdicts and evidence as the assistant turn. Labels are adjudicated R/C verdicts plus capped agreed items; the held-out set is excluded. The JSONL alone here; GET /export/judge-sft.tar.gz adds the PNGs and the manifest.",
    filename: "judge-sft.jsonl",
    exporter: exportJudgeSftJsonl,
  },
];

export function listFormats(): readonly FormatDefinition[] {
  return formats;
}

export function getFormat(id: ExportFormatId): FormatDefinition | undefined {
  return formats.find((f) => f.id === id);
}
