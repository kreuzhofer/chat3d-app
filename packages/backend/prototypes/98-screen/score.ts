/**
 * #98: score every candidate judge's run against the gold — Daniel's R/C verdicts
 * on the corpus sittings (seeds 93–100) — and report completeness and errors by
 * direction. Truth on a gold item is the state of the judge Daniel sided with.
 *
 *   npx tsx prototypes/98-screen/score.ts <plan.txt>   (lines: experimentId runId model selection)
 */
import { readFileSync } from "node:fs";
import { prisma } from "../../src/db/prisma.js";
import { loadRun } from "../../src/services/qualification-screen-load.service.js";

const plan = readFileSync(process.argv[2] ?? "prototypes/98-screen/plan.txt", "utf8").trim().split("\n").map((l) => l.split(/\s+/)).filter((p) => p.length >= 4 && p[0] !== "ERR");
const gold = await prisma.adjudication.findMany({
  where: { decision: { in: ["R", "C"] }, decisionSource: { in: ["human", "carried"] }, sitting: { title: { startsWith: "#91 gold sitting, seed " }, createdAt: { gt: new Date("2026-09-17") } } },
  select: { exampleId: true, itemIndex: true, question: true, refState: true, candState: true, decision: true },
});
const truth = new Map(gold.map((g) => [`${g.exampleId}:${g.itemIndex}`, { question: g.question, state: g.decision === "R" ? g.refState : g.candState, incumbent: g.candState }]));
const rows: string[] = [];
for (const [, runId, model, sel] of plan) {
  if (sel !== "gold") continue;
  let run; try { run = await loadRun(runId); } catch (e) { rows.push(`${model}\tgold\tunloadable: ${(e as Error).message.slice(0, 60)}`); continue; }
  let answered = 0, items = 0, unanswered = 0, right = 0, wrong = 0, uncertain = 0, missed = 0; const byDir: Record<string, number> = {};
  for (const r of run.rows) {
    if (!r.checklistResults) { unanswered++; continue; }
    answered++;
    r.checklistResults.forEach((it, i) => {
      const t = truth.get(`${r.exampleId}:${i}`); if (!t) return;
      items++;
      if (t.question.trim() !== (it.question ?? "").trim()) { missed++; return; }
      const s = it.pass === true ? "pass" : it.pass === false ? "fail" : "uncertain";
      if (s === "uncertain") { uncertain++; return; }
      if (s === t.state) right++; else { wrong++; const k = `${t.incumbent === "fail" ? "false-fail item" : "false-pass item"}: says ${s}`; byDir[k] = (byDir[k] ?? 0) + 1; }
    });
  }
  rows.push(`${model}\tgold\texamples ${answered}/${run.rows.length}\tgold items ${items}\tright ${right}\twrong ${wrong}\tuncertain ${uncertain}\tquestion-mismatch ${missed}\t${JSON.stringify(byDir)}`);
}
console.log(rows.join("\n"));
await prisma.$disconnect(); process.exit(0);
