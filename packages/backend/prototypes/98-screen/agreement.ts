/**
 * #98: pairwise item agreement on the 125 between every candidate run and the
 * anchors (incumbent arm A, rc0 arm A, Kimi-off, GLM-off, and each other).
 *   npx tsx prototypes/98-screen/agreement.ts <label=runId> ...
 */
import { prisma } from "../../src/db/prisma.js";
import { loadRun } from "../../src/services/qualification-screen-load.service.js";
import { pairItems } from "../../src/services/qualification-screen.service.js";

const args = process.argv.slice(2).map((a) => a.split("="));
const runs: Array<{ label: string; run: Awaited<ReturnType<typeof loadRun>> }> = [];
for (const [label, id] of args) runs.push({ label, run: await loadRun(id) });
const cell = (a: typeof runs[number], b: typeof runs[number]) => {
  const pairs = pairItems(a.run, b.run);
  let same = 0, hard = 0, aPass = 0, bPass = 0, n = 0;
  for (const p of pairs) {
    const ap = p.cand.pass, bp = p.ref.pass; n++;
    if (ap === bp) same++;
    if (typeof ap === "boolean" && typeof bp === "boolean" && ap !== bp) { hard++; if (ap) aPass++; else bPass++; }
  }
  return { n, same, hard, aPass, bPass };
};
const passRate = (r: typeof runs[number]) => { let p = 0, n = 0; for (const x of r.run.rows) for (const it of x.checklistResults ?? []) { n++; if (it.pass === true) p++; } return n ? (100 * p / n).toFixed(1) : "-"; };
console.log("model\tpass%\t" + runs.map((r) => r.label).join("\t"));
for (const a of runs) {
  const row = [a.label, passRate(a)];
  for (const b of runs) { if (a === b) { row.push("—"); continue; } const c = cell(a, b); row.push(`${(100 * c.same / c.n).toFixed(1)}% (${c.hard}: ${c.aPass}/${c.bPass})`); }
  console.log(row.join("\t"));
}
console.log("\ncell = identical items % (hard flips: row-passes-where-column-fails / column-passes-where-row-fails)");
await prisma.$disconnect(); process.exit(0);
