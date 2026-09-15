/**
 * One judge training sample (issue #94) — pure.
 *
 * OpenAI chat format: system = the current Instrument rendered with the
 * example's specimen over the labelled items only; user = the judge's own
 * user message, the eight views as image parts by relative path; assistant =
 * the production response shape with the labelled items' verdicts and
 * evidence. The PNGs travel beside the JSONL under `images/`.
 */
import { buildEvaluationSystemPrompt } from "../visual-eval-prompt.service.js";
import { STANDARD_VIEWS, VIEW_LABELS, type StandardView } from "../visual-eval-views.js";
import type { LabelledItem, LabelSource } from "./judge-sft-labels.js";
import type { ReferenceSummary } from "./judge-sft-pool.js";

/** The judge's leading user text (visual-eval.service `buildImageUserContent`). */
export const USER_LEAD = "Please evaluate the following 3D model images:";

export interface SampleExample {
  id: string;
  categoryName: string;
  complexity: number;
  userPrompt: string;
  constructionSpec: string;
  /** Each standard view's stored value: a storage-relative path, or inline image data. */
  screenshots: Record<StandardView, string>;
}

export interface SampleImage {
  /** Path inside the tarball, and in the sample. */
  name: string;
  /** Storage-relative path to copy, when the column held one. */
  storagePath?: string;
  /** Inline PNG (base64, with or without a data: prefix), when the column held the bytes. */
  inline?: string;
}

export interface SampleManifestEntry {
  id: string;
  category: string;
  sittings: string[];
  source: LabelSource;
  items: Array<{ position: number; corpusIndex: number; source: LabelSource; decision: "R" | "C" | null; pass: boolean }>;
}

export interface BuiltSample {
  line: Record<string, unknown>;
  images: SampleImage[];
  manifest: SampleManifestEntry;
}

export function imageName(exampleId: string, view: StandardView): string {
  return `images/${exampleId}-${view}.png`;
}

export function buildSample(example: SampleExample, items: LabelledItem[], reference: ReferenceSummary | undefined): BuiltSample {
  if (items.length === 0) throw new Error(`No labelled items for ${example.id}`);
  const ordered = [...items].sort((a, b) => a.index - b.index);
  const system = buildEvaluationSystemPrompt({
    userPrompt: example.userPrompt,
    categoryName: example.categoryName,
    complexity: example.complexity,
    constructionSpec: example.constructionSpec,
    checklist: ordered.map((i) => i.question),
  });

  const images: SampleImage[] = [];
  const content: Array<Record<string, unknown>> = [{ type: "text", text: USER_LEAD }];
  for (const view of STANDARD_VIEWS) {
    const stored = example.screenshots[view];
    if (!stored) throw new Error(`${example.id} has no ${view} view`);
    const name = imageName(example.id, view);
    images.push(stored.startsWith("data:") || stored.length > 500 ? { name, inline: stored } : { name, storagePath: stored });
    content.push({ type: "text", text: `${VIEW_LABELS[view]}:` });
    content.push({ type: "image_url", image_url: { url: name } });
  }

  const assistant = {
    score: reference?.score ?? null,
    issues: reference?.issues ?? [],
    suggestions: reference?.suggestions ?? [],
    checklist: ordered.map((i) => ({ question: i.question, pass: i.pass, detail: i.detail })),
  };

  const sources = new Set(ordered.map((i) => i.source));
  return {
    line: {
      id: example.id,
      images: images.map((i) => i.name),
      messages: [
        { role: "system", content: system },
        { role: "user", content },
        { role: "assistant", content: JSON.stringify(assistant) },
      ],
    },
    images,
    manifest: {
      id: example.id,
      category: example.categoryName,
      sittings: [...new Set(ordered.map((i) => i.sittingId))],
      source: sources.has("adjudicated") ? "adjudicated" : "agreed",
      items: ordered.map((i, n) => ({ position: n + 1, corpusIndex: i.index, source: i.source, decision: i.decision, pass: i.pass })),
    },
  };
}
