/** #113: how many prompts (and how many gold-bearing ones) the screen would change if applied to stored atoms in place. */
import { prisma } from "../../src/db/prisma.js";
import { screenAtoms } from "../../src/services/requirement-atoms.js";
import type { AnnotatedCriterion } from "../../src/services/spec-generation.service.js";

const prompts = await prisma.workbenchExamplePrompt.findMany({ where: { examples: { some: {} } }, select: { id: true, prompt: true, verificationCriteria: true } });
const gold = new Set((await prisma.$queryRaw<Array<{ prompt_id: string }>>`select distinct e.prompt_id from adjudications a join workbench_examples e on e.id=a.example_id where a.decision in ('R','C') and a.decision_source in ('human','carried')`).map((r) => r.prompt_id));
let atomsPrompts = 0, changed = 0, changedGold = 0, dropped = 0, routed = 0; const byReason: Record<string, number> = {};
for (const p of prompts) {
  const c = p.verificationCriteria as unknown;
  if (!Array.isArray(c) || c.length === 0 || typeof c[0] !== "object") continue;
  atomsPrompts++;
  const s = screenAtoms(c as AnnotatedCriterion[], p.prompt);
  if (s.dropped.length || s.routed.length) { changed++; if (gold.has(p.id)) changedGold++; }
  dropped += s.dropped.length; routed += s.routed.length;
  for (const d of s.dropped) byReason[`${d.reason}:${d.word ?? ""}`] = (byReason[`${d.reason}:${d.word ?? ""}`] ?? 0) + 1;
}
console.log(JSON.stringify({ atomsPrompts, goldPrompts: gold.size, changed, changedGold, dropped, routed, byReason }));
await prisma.$disconnect(); process.exit(0);
