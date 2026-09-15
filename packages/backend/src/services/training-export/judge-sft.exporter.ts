/**
 * The judge training export (issue #94): samples from the pool, one per
 * example, plus the manifest the training side checks the held-out set
 * against. `exportJudgeSftJsonl` is the registry's entry (JSONL only, image
 * paths relative); `buildJudgeSftExport` is what the tarball route streams.
 */
import { prisma } from "../../db/prisma.js";
import { STANDARD_VIEWS, type StandardView } from "../visual-eval-views.js";
import type { ExportRequest } from "./types.js";
import { loadJudgePool, type JudgePool } from "./judge-sft-pool.js";
import { buildSample, type SampleExample, type SampleImage, type SampleManifestEntry } from "./judge-sft-sample.js";
import type { LabelledItem } from "./judge-sft-labels.js";

export const JUDGE_SFT_FORMAT = "judge-sft/openai-chat-v1";

export interface JudgeSftManifest {
  format: typeof JUDGE_SFT_FORMAT;
  generatedAt: string;
  instrumentId: string;
  /** How each sample's fields were filled, for the training side's reading. */
  rules: { evidence: string; scoreAndIssues: string; views: string };
  heldOut: JudgePool["heldOut"] & { count: number; siblingCount: number };
  judgePairs: Array<Pick<JudgePool["sittings"][number], "id" | "title" | "candidateLabel" | "referenceLabel" | "labelled" | "heldOut" | "drops">>;
  skippedSittings: JudgePool["skipped"];
  cap: JudgePool["cap"];
  counts: { samples: number; items: number; adjudicated: number; agreed: number; passes: number; fails: number };
  samples: SampleManifestEntry[];
}

export interface JudgeSftExport {
  jsonl: string;
  manifest: JudgeSftManifest;
  images: SampleImage[];
}

const SCREENSHOT_FIELD: Record<StandardView, "screenshotFront" | "screenshotBack" | "screenshotLeft" | "screenshotRight" | "screenshotTop" | "screenshotBottom" | "screenshotOrtho45" | "screenshotOrtho45Bottom"> = {
  front: "screenshotFront", back: "screenshotBack", left: "screenshotLeft", right: "screenshotRight",
  top: "screenshotTop", bottom: "screenshotBottom", ortho_45: "screenshotOrtho45", ortho_45_bottom: "screenshotOrtho45Bottom",
};

async function loadExamples(ids: string[]): Promise<Map<string, SampleExample>> {
  const rows = await prisma.workbenchExample.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      screenshotFront: true, screenshotBack: true, screenshotLeft: true, screenshotRight: true,
      screenshotTop: true, screenshotBottom: true, screenshotOrtho45: true, screenshotOrtho45Bottom: true,
      promptRef: { select: { prompt: true, constructionSpec: true, category: { select: { name: true, complexity: true } } } },
    },
  });
  const out = new Map<string, SampleExample>();
  for (const r of rows) {
    const screenshots = {} as Record<StandardView, string>;
    for (const view of STANDARD_VIEWS) {
      const v = r[SCREENSHOT_FIELD[view]];
      if (!v) throw new Error(`${r.id} has no ${view} view; the judge cannot have answered it`);
      screenshots[view] = v;
    }
    out.set(r.id, {
      id: r.id,
      categoryName: r.promptRef.category.name,
      complexity: r.promptRef.category.complexity,
      userPrompt: r.promptRef.prompt,
      constructionSpec: r.promptRef.constructionSpec ?? "",
      screenshots,
    });
  }
  return out;
}

export async function buildJudgeSftExport(): Promise<JudgeSftExport> {
  const pool = await loadJudgePool();
  const byExample = new Map<string, LabelledItem[]>();
  for (const item of pool.items) {
    const list = byExample.get(item.exampleId) ?? [];
    list.push(item);
    byExample.set(item.exampleId, list);
  }
  const examples = await loadExamples([...byExample.keys()]);

  const lines: string[] = [];
  const images: SampleImage[] = [];
  const samples: SampleManifestEntry[] = [];
  for (const exampleId of [...byExample.keys()].sort()) {
    const example = examples.get(exampleId);
    if (!example) throw new Error(`Example ${exampleId} is labelled but no longer in the corpus`);
    const built = buildSample(example, byExample.get(exampleId)!, pool.reference.get(exampleId));
    lines.push(JSON.stringify(built.line));
    images.push(...built.images);
    samples.push(built.manifest);
  }

  const items = pool.items;
  const manifest: JudgeSftManifest = {
    format: JUDGE_SFT_FORMAT,
    generatedAt: new Date().toISOString(),
    instrumentId: pool.instrumentId,
    rules: {
      evidence: "adjudicated R: the reference's detail; adjudicated C: the candidate's; agreed: the reference's. The zoom merge's prefix is stripped.",
      scoreAndIssues: "the reference's score, issues and suggestions for the whole example; the checklist lists only the labelled items, in corpus order.",
      views: "the eight standard views, labelled as the judge's user message labels them, by path relative to the tarball root.",
    },
    heldOut: { ...pool.heldOut, count: pool.heldOut.exampleIds.length, siblingCount: pool.heldOut.siblingExampleIds.length },
    judgePairs: pool.sittings.map(({ id, title, candidateLabel, referenceLabel, labelled, heldOut, drops }) => ({ id, title, candidateLabel, referenceLabel, labelled, heldOut, drops })),
    skippedSittings: pool.skipped,
    cap: pool.cap,
    counts: {
      samples: samples.length,
      items: items.length,
      adjudicated: items.filter((i) => i.source === "adjudicated").length,
      agreed: items.filter((i) => i.source === "agreed").length,
      passes: items.filter((i) => i.pass).length,
      fails: items.filter((i) => !i.pass).length,
    },
    samples,
  };
  return { jsonl: lines.join("\n"), manifest, images };
}

/** The registry's exporter: the JSONL alone; the request's codegen filters do not apply to a judge sample. */
export async function exportJudgeSftJsonl(_req: ExportRequest): Promise<string> {
  return (await buildJudgeSftExport()).jsonl;
}
