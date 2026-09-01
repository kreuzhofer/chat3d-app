/**
 * Issue #34 — what changes when the visual judge is given a real checklist.
 *
 * Compares the stored score of each sampled example (produced against the
 * pre-#33 placeholder checklist) with a fresh evaluation of the same renders
 * against the real checklist, and reports the delta and the auto-approval
 * threshold crossings that actually change the dataset.
 *
 * Reads only. The originals are never touched: the new scores live in
 * vlm_experiment_results, and the recomputed approval decision is derived here
 * rather than written back.
 *
 * Composite and approval are recomputed with the production helpers, not
 * reimplemented — the code score, weights and threshold are held at their
 * stored/current values so the visual score is the only thing that moved.
 */
import { prisma } from "../db/prisma.js";
import {
  computeCompositeScore,
  resolveCodeEvalWeight,
} from "../services/code-eval-composite.service.js";
import { shouldAutoApprove } from "../services/workbench-pipeline-helpers.service.js";
import {
  getAutoApproveThreshold,
  getCodeEvalWeight,
  getAdaptiveWeightRange,
  isAdaptiveWeightEnabled,
} from "../services/generation-settings.service.js";
import { parseEvalPlan } from "../utils/eval-plan.js";
import { toAnnotatedCriteria } from "../utils/verification-criteria.js";

const RUN_ID = process.argv[2];
if (!RUN_ID) throw new Error("usage: analyze-issue-34.ts <experiment_run_id>");

type Row = {
  category: string;
  storedVisual: number | null;
  storedComposite: number | null;
  storedApproved: boolean;
  newVisual: number | null;
  newComposite: number | null;
  newApproved: boolean;
  /** For a lost approval: what actually gated it. */
  lostBecause: "checklist" | "score" | null;
};

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
const f = (x: number | null, d = 2) => (x === null ? "  —  " : x.toFixed(d));

async function main() {
  const threshold = await getAutoApproveThreshold("workbench");
  const codeEvalWeight = await getCodeEvalWeight("workbench");
  const adaptiveRange = (await isAdaptiveWeightEnabled()) ? await getAdaptiveWeightRange() : 0;

  const results = await prisma.vlmExperimentResult.findMany({
    where: { runId: RUN_ID },
    select: { exampleId: true, visualScore: true, checklistResults: true, error: true },
  });

  const examples = await prisma.workbenchExample.findMany({
    where: { id: { in: results.map((r) => r.exampleId) } },
    select: {
      id: true, visualScore: true, evalScore: true, codeEvalScore: true,
      assertionPassRate: true, approvalStatus: true, compositeWeightSource: true,
      promptRef: {
        select: {
          verificationCriteria: true,
          evalPlan: true,
          category: { select: { name: true } },
        },
      },
    },
  });
  const byId = new Map(examples.map((e) => [e.id, e]));

  const rows: Row[] = [];
  let failed = 0;

  for (const r of results) {
    const ex = byId.get(r.exampleId);
    if (!ex) continue;
    if (r.error || r.visualScore === null) { failed++; continue; }

    const criteria = toAnnotatedCriteria(ex.promptRef.verificationCriteria);
    const newVisual = Number(r.visualScore);
    const codeScore = ex.codeEvalScore === null ? null : Number(ex.codeEvalScore);
    const assertionPassRate = ex.assertionPassRate === null ? null : Number(ex.assertionPassRate);

    // Mirror the orchestrator exactly: it resolves the weight, then passes
    // that resolved weight *together with* the criteria and range into
    // computeCompositeScore. Reproducing that faithfully — including the
    // second adaptation it implies — is what keeps the visual score the only
    // thing that differs between the stored value and this one.
    const resolved = resolveCodeEvalWeight({
      globalDefault: codeEvalWeight,
      evalPlan: parseEvalPlan(ex.promptRef.evalPlan ?? null),
      annotatedCriteria: criteria,
      adaptiveWeightRange: adaptiveRange,
    });
    const composite = computeCompositeScore(
      newVisual, codeScore, assertionPassRate, resolved.weight,
      criteria, adaptiveRange, resolved.source,
    );

    const checklist = (r.checklistResults as Array<{ pass: boolean | null }> | null) ?? null;

    const newApproved = shouldAutoApprove(composite.compositeScore, threshold, checklist, true);
    const storedApproved = ex.approvalStatus === "auto_approved";
    // A lost approval has two very different meanings. If the new composite is
    // still at or above the threshold, the example was gated by a real
    // checklist question it failed — something a placeholder list could never
    // catch, and squarely the effect #33 fixed. If the composite itself fell
    // below the threshold, that is score movement, which this single-arm
    // design cannot separate from judge run-to-run variance.
    const lostBecause: Row["lostBecause"] = !(storedApproved && !newApproved)
      ? null
      : composite.compositeScore !== null && composite.compositeScore >= threshold
        ? "checklist"
        : "score";

    rows.push({
      category: ex.promptRef.category.name,
      storedVisual: ex.visualScore === null ? null : Number(ex.visualScore),
      storedComposite: ex.evalScore === null ? null : Number(ex.evalScore),
      storedApproved,
      newVisual,
      newComposite: composite.compositeScore,
      newApproved,
      lostBecause,
    });
  }

  console.log(`\nIssue #34 — real checklist vs. placeholder checklist`);
  console.log(`run ${RUN_ID}`);
  console.log(`auto-approve threshold ${threshold}, code weight ${codeEvalWeight}`);
  console.log(`${rows.length} evaluated, ${failed} failed\n`);

  const cats = [...new Set(rows.map((r) => r.category))].sort();
  const header =
    "category                     |   n | visual: was → now      Δ | approved: was → now  (gained/lost)";
  console.log(header);
  console.log("-".repeat(header.length));

  const line = (name: string, rs: Row[]) => {
    const was = mean(rs.map((r) => r.storedVisual).filter((x): x is number => x !== null));
    const now = mean(rs.map((r) => r.newVisual).filter((x): x is number => x !== null));
    const apprWas = rs.filter((r) => r.storedApproved).length;
    const apprNow = rs.filter((r) => r.newApproved).length;
    const gained = rs.filter((r) => !r.storedApproved && r.newApproved).length;
    const lost = rs.filter((r) => r.storedApproved && !r.newApproved).length;
    const delta = was !== null && now !== null ? now - was : null;
    const deltaStr = delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
    console.log(
      `${name.padEnd(28)} | ${String(rs.length).padStart(3)} | ` +
      `${f(was)} → ${f(now)}  ${deltaStr.padStart(5)}` +
      ` | ${String(apprWas).padStart(3)} → ${String(apprNow).padStart(3)}   (+${gained} / -${lost})`,
    );
  };

  for (const c of cats) line(c, rows.filter((r) => r.category === c));
  console.log("-".repeat(header.length));
  line("ALL", rows);

  const gained = rows.filter((r) => !r.storedApproved && r.newApproved).length;
  const lost = rows.filter((r) => r.storedApproved && !r.newApproved).length;
  const lostChecklist = rows.filter((r) => r.lostBecause === "checklist").length;
  const lostScore = rows.filter((r) => r.lostBecause === "score").length;
  console.log(
    `\nThreshold crossings: ${lost} approved example(s) would lose approval, ` +
    `${gained} pending example(s) would gain it. Net ${gained - lost >= 0 ? "+" : ""}${gained - lost}.`,
  );
  console.log(
    `  of the ${lost} lost: ${lostChecklist} failed a real checklist question while still ` +
    `scoring >= ${threshold} (attributable to the fix), ` +
    `${lostScore} fell below ${threshold} on score alone (not separable from judge variance ` +
    `in this single-arm design).`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
