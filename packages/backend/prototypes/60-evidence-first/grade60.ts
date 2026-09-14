/**
 * PROTOTYPE — wayfinder #60. Grades an evidence-first arm against the truth
 * the adjudications already fix, and reads its direction against the control.
 *
 *   npx tsx prototypes/60-evidence-first/grade60.ts <arm experiment id> <control run id>
 *
 * Truth: every decided adjudication on an example of the arm whose decision is
 * R or C — the correct answer to that item is the reference's frozen answer on
 * R and the candidate's on C (ADR 0004). Items decided N have no truth and are
 * not graded. Sittings under an earlier instrument count too: the checklist
 * items are the same questions at the same positions, and the truth is about
 * the render, not the judge.
 *
 * Readouts, in the order they decide anything:
 *   BENEFIT   on the truth-graded items: control right → arm right/wrong, control wrong → arm right/wrong.
 *   DIRECTION over every item both answered: the 3×3 matrix control → arm, hard flips by direction,
 *             pass rate, uncertain rate — a leniency shift would read as an improvement on the
 *             graded set by construction (#66), so this is read beside BENEFIT, never instead of it.
 *   BUDGET    truncated or failed evaluations (the completeness term); the arm is void if any.
 */
import { prisma } from "../../src/db/prisma.js";
import { itemState, type StoredChecklistItem } from "../../src/services/qualification-screen.service.js";

type State = "P" | "F" | "U";
const WORD: Record<string, State> = { pass: "P", fail: "F", uncertain: "U" };

async function loadRunItems(runId: string): Promise<{ items: Map<string, State>; rows: number; failed: number; truncated: number }> {
  const results = await prisma.vlmExperimentResult.findMany({ where: { runId }, select: { exampleId: true, checklistResults: true, error: true, issues: true, instrumentId: true } });
  const items = new Map<string, State>();
  let failed = 0, truncated = 0;
  for (const r of results) {
    const issues = Array.isArray(r.issues) ? (r.issues as unknown[]).map(String) : [];
    if (r.error || !r.instrumentId || issues.some((i) => i.startsWith("Evaluation failed:"))) { failed++; continue; }
    if (issues.some((i) => i.includes('finish reason "length"'))) truncated++;
    const list = Array.isArray(r.checklistResults) ? (r.checklistResults as StoredChecklistItem[]) : [];
    list.forEach((it, i) => items.set(`${r.exampleId}#${i}`, itemState(it)));
  }
  return { items, rows: results.length, failed, truncated };
}

async function main(): Promise<void> {
  const [experimentId, controlRunId] = process.argv.slice(2);
  if (!experimentId || !controlRunId) throw new Error("usage: grade60.ts <arm experiment id> <control run id>");
  const run = await prisma.experimentRun.findFirst({ where: { experimentId }, orderBy: { runOrder: "asc" }, select: { id: true, modelLabel: true, judgePromptVariantId: true, judgeResponseShape: true, status: true } });
  if (!run) throw new Error("no run on that experiment");
  const arm = await loadRunItems(run.id);
  const control = await loadRunItems(controlRunId);
  const armIds = (await prisma.vlmExperimentResult.findMany({ where: { runId: run.id }, select: { exampleId: true }, distinct: ["exampleId"] })).map((r) => r.exampleId);

  console.log(`arm: ${run.modelLabel} · variant ${run.judgePromptVariantId} · shape ${run.judgeResponseShape} · run ${run.id} (${run.status})`);
  console.log(`BUDGET  rows ${arm.rows} | failed evaluations ${arm.failed} | truncated ${arm.truncated}  (control: failed ${control.failed}, truncated ${control.truncated})`);
  if (arm.failed > 0 || arm.truncated > 0) console.log("  → the completeness term is zero tolerance: this arm is not a pair until the counts are 0");

  // truth from the adjudications
  const decided = await prisma.adjudication.findMany({
    where: { exampleId: { in: armIds }, decision: { in: ["R", "C"] } },
    select: { exampleId: true, itemIndex: true, decision: true, refState: true, candState: true, sitting: { select: { title: true, instrumentId: true } } },
  });
  const truth = new Map<string, State>();
  const sources = new Map<string, number>();
  for (const a of decided) {
    const correct = a.decision === "R" ? a.refState : a.candState;
    const st = WORD[correct]; if (!st || st === "U") continue;
    const key = `${a.exampleId}#${a.itemIndex}`;
    if (truth.has(key) && truth.get(key) !== st) { truth.delete(key); continue; } // two sittings disagree on the truth: skip
    truth.set(key, st);
    sources.set(a.sitting.title, (sources.get(a.sitting.title) ?? 0) + 1);
  }
  console.log(`\nBENEFIT  truth-graded items on the arm's examples: ${truth.size}`);
  for (const [t, n] of sources) console.log(`  from ${t.slice(0, 60)}: ${n}`);
  const b = { cr_ar: 0, cr_aw: 0, cw_ar: 0, cw_aw: 0, unanswered: 0, uncertainArm: 0 };
  for (const [key, t] of truth) {
    const c = control.items.get(key), a = arm.items.get(key);
    if (c === undefined || a === undefined) { b.unanswered++; continue; }
    if (a === "U") b.uncertainArm++;
    const cRight = c === t, aRight = a === t;
    if (cRight && aRight) b.cr_ar++; else if (cRight && !aRight) b.cr_aw++; else if (!cRight && aRight) b.cw_ar++; else b.cw_aw++;
  }
  console.log(`  control right → arm right ${b.cr_ar}, arm wrong ${b.cr_aw} (BROKEN)`);
  console.log(`  control wrong → arm right ${b.cw_ar} (FIXED), arm wrong ${b.cw_aw}`);
  console.log(`  net ${b.cw_ar - b.cr_aw} | arm uncertain on graded items ${b.uncertainArm} | unanswered ${b.unanswered}`);

  // direction over every item both answered
  const m: Record<State, Record<State, number>> = { P: { P: 0, F: 0, U: 0 }, F: { P: 0, F: 0, U: 0 }, U: { P: 0, F: 0, U: 0 } };
  let both = 0;
  for (const [key, c] of control.items) { const a = arm.items.get(key); if (a === undefined) continue; both++; m[c][a]++; }
  const armPass = [...arm.items.values()].filter((s) => s === "P").length, armU = [...arm.items.values()].filter((s) => s === "U").length;
  const ctlPass = [...control.items.values()].filter((s) => s === "P").length, ctlU = [...control.items.values()].filter((s) => s === "U").length;
  console.log(`\nDIRECTION  items both answered ${both} | identical ${(100 * (m.P.P + m.F.F + m.U.U) / Math.max(1, both)).toFixed(1)}%`);
  console.log(`  control \\ arm      P      F      U`);
  for (const r of ["P", "F", "U"] as State[]) console.log(`  ${r.padStart(9)}      ${String(m[r].P).padStart(4)}   ${String(m[r].F).padStart(4)}   ${String(m[r].U).padStart(4)}`);
  console.log(`  hard flips: fail→pass ${m.F.P}, pass→fail ${m.P.F} (${(100 * (m.F.P + m.P.F) / Math.max(1, both)).toFixed(1)}%; the floor is 2.9%)`);
  console.log(`  pass rate control ${(100 * ctlPass / Math.max(1, control.items.size)).toFixed(1)}% → arm ${(100 * armPass / Math.max(1, arm.items.size)).toFixed(1)}% | uncertain control ${ctlU} → arm ${armU}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
