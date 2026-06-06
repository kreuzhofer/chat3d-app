import type { RenderedFile } from "./rendering.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";
import type {
  ComponentChecklistItem,
  ComponentVerificationResult,
  ChecklistItemResult,
  ChecklistVerdict,
} from "../utils/component-checklist.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("checklist-eval");

export interface ChecklistFocusedEvalArgs {
  item: string;
  code: string;
  images: RenderedFile[];
}

export interface ChecklistFocusedEvalResult {
  verdict: ChecklistVerdict;
  reasoning: string;
}

export interface RunChecklistEvalInput {
  checklist: ComponentChecklistItem[];
  code: string;
  renderedFiles: RenderedFile[];
  evalPlan: EvalPlan | null;
  visualVerify: (args: ChecklistFocusedEvalArgs) => Promise<ChecklistFocusedEvalResult>;
  codeVerify: (args: ChecklistFocusedEvalArgs) => Promise<ChecklistFocusedEvalResult>;
}

const ANGLE_FROM_FILENAME = (fileName: string): string => {
  // file shapes: `<name>_front.png` (with prefix) or `front.png` (bare angle). Match suffix.
  const withPrefix = fileName.match(/_([a-z0-9_]+)\.(png|jpg|jpeg)$/i);
  if (withPrefix) return withPrefix[1];
  const bare = fileName.match(/^([a-z0-9_]+)\.(png|jpg|jpeg)$/i);
  if (bare) return bare[1];
  return fileName;
};

function filterImagesByPlan(files: RenderedFile[], evalPlan: EvalPlan | null): RenderedFile[] {
  if (!evalPlan?.inspectionPlan?.angles?.length) return files;
  const wanted = new Set(evalPlan.inspectionPlan.angles);
  const filtered = files.filter((f) => wanted.has(ANGLE_FROM_FILENAME(f.fileName) as never));
  return filtered.length > 0 ? filtered : files;
}

function combine(
  visual: ChecklistFocusedEvalResult | null,
  code: ChecklistFocusedEvalResult | null,
): ChecklistFocusedEvalResult {
  const parts: string[] = [];
  if (visual) parts.push(`visual: ${visual.reasoning}`);
  if (code) parts.push(`code: ${code.reasoning}`);
  const verdicts = [visual?.verdict, code?.verdict].filter(Boolean) as ChecklistVerdict[];
  let verdict: ChecklistVerdict;
  if (verdicts.includes("FAIL")) verdict = "FAIL";
  else if (verdicts.every((v) => v === "PASS")) verdict = "PASS";
  else verdict = "UNCERTAIN";
  return { verdict, reasoning: parts.join(" | ") };
}

export async function runChecklistEval(
  input: RunChecklistEvalInput,
): Promise<ComponentVerificationResult> {
  const { checklist, code, renderedFiles, evalPlan, visualVerify, codeVerify } = input;
  if (checklist.length === 0) {
    return { results: [], passedCount: 0, failedCount: 0, uncertainCount: 0 };
  }

  const visualImages = filterImagesByPlan(renderedFiles, evalPlan);

  const results: ChecklistItemResult[] = await Promise.all(
    checklist.map(async (entry, index): Promise<ChecklistItemResult> => {
      try {
        const wantVisual = entry.visibility === "visual" || entry.visibility === "both";
        const wantCode = entry.visibility === "code" || entry.visibility === "both";

        const [v, c] = await Promise.all([
          wantVisual
            ? visualVerify({ item: entry.item, code, images: visualImages })
            : Promise.resolve(null),
          wantCode
            ? codeVerify({ item: entry.item, code, images: visualImages })
            : Promise.resolve(null),
        ]);

        const combined = combine(v, c);
        return {
          index,
          item: entry.item,
          visibility: entry.visibility,
          verdict: combined.verdict,
          reasoning: combined.reasoning,
        };
      } catch (err) {
        logger.warn({ err, index, item: entry.item }, "checklist item eval failed");
        return {
          index,
          item: entry.item,
          visibility: entry.visibility,
          verdict: "UNCERTAIN",
          reasoning: `eval failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  const passedCount = results.filter((r) => r.verdict === "PASS").length;
  const failedCount = results.filter((r) => r.verdict === "FAIL").length;
  const uncertainCount = results.filter((r) => r.verdict === "UNCERTAIN").length;

  return { results, passedCount, failedCount, uncertainCount };
}
