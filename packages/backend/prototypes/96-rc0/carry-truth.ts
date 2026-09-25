/**
 * #96/#112: pre-decide a sitting's items from the TRUE STATE Daniel already
 * established for the same item in any earlier sitting — whatever the other
 * judge was. A human R means the reference's state was the truth, C the
 * candidate's. An item whose truth is known and matches one side here gets
 * that side (R or C), decision_source "carried", with the source sittings
 * in the note. Conflicting truths or unknown items stay open. N carries as N.
 *
 *   npx tsx prototypes/96-rc0/carry-truth.ts <sittingId> [--apply]
 */
import { prisma } from "../../src/db/prisma.js";

const sittingId = process.argv[2]; const apply = process.argv.includes("--apply");
const norm = (q: string) => q.trim().toLowerCase();
const key = (e: string, i: number, q: string) => `${e}:${i}:${norm(q)}`;

const target = await prisma.adjudication.findMany({ where: { sittingId, decision: null }, select: { id: true, exampleId: true, itemIndex: true, question: true, refState: true, candState: true } });
const prior = await prisma.adjudication.findMany({
  where: { sittingId: { not: sittingId }, decision: { in: ["R", "C", "N"] }, OR: [{ decisionSource: "human" }, { decisionSource: "carried" }, { decisionSource: null }], exampleId: { in: [...new Set(target.map((t) => t.exampleId))] } },
  select: { exampleId: true, itemIndex: true, question: true, refState: true, candState: true, decision: true, sitting: { select: { title: true } } },
});
const truth = new Map<string, { states: Set<string>; n: boolean; from: Set<string> }>();
for (const p of prior) {
  const k = key(p.exampleId, p.itemIndex, p.question);
  const t = truth.get(k) ?? { states: new Set(), n: false, from: new Set() };
  if (p.decision === "N") t.n = true; else t.states.add(p.decision === "R" ? p.refState : p.candState);
  t.from.add(p.sitting.title.slice(0, 40)); truth.set(k, t);
}
let r = 0, c = 0, n = 0, conflict = 0, neither = 0, unknown = 0;
for (const it of target) {
  const t = truth.get(key(it.exampleId, it.itemIndex, it.question));
  if (!t) { unknown++; continue; }
  let decision: "R" | "C" | "N" | null = null;
  if (t.states.size > 1) { conflict++; continue; }
  if (t.states.size === 1) {
    const s = [...t.states][0];
    if (s === it.refState) decision = "R"; else if (s === it.candState) decision = "C"; else { neither++; continue; }
  } else if (t.n) decision = "N";
  if (!decision) { unknown++; continue; }
  if (decision === "R") r++; else if (decision === "C") c++; else n++;
  if (apply) await prisma.adjudication.update({ where: { id: it.id }, data: { decision, decisionSource: "carried", note: `carried by true state from: ${[...t.from].join(" · ")}`, decidedAt: new Date() } });
}
console.log(JSON.stringify({ sittingId, open: target.length, carriedR: r, carriedC: c, carriedN: n, conflict, neither, stillOpen: unknown + conflict + neither, applied: apply }));
await prisma.$disconnect(); process.exit(0);
