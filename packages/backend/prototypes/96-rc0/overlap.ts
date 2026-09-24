/**
 * #96: which of rc0's disagreements with the reference on the 125 already carry
 * Daniel's verdict from #85 (the incumbent's 70 disagreements with the same
 * reference run, same rows, same items)? Those carry over; the rest are new.
 */
import { prisma } from "../../src/db/prisma.js";
import { loadRun } from "../../src/services/qualification-screen-load.service.js";
import { pairItems } from "../../src/services/qualification-screen.service.js";

const RC0 = process.argv[2] ?? "2f629877-dab6-452b-a011-5dc5dab54c4a";
const REF = "bc4354d4-f946-4775-bf08-5e64f726c3a1";
const SITTING_85 = "1970ebbb-5f21-4ff1-8f1b-e625b80c0e11";

const [cand, ref] = await Promise.all([loadRun(RC0), loadRun(REF)]);
const pairs = pairItems(cand, ref);
const pf = (s: unknown) => s === true ? "pass" : s === false ? "fail" : "uncertain";
const flips = pairs.filter((p) => typeof p.ref.pass === "boolean" && typeof p.cand.pass === "boolean" && p.ref.pass !== p.cand.pass);
const decided = await prisma.adjudication.findMany({ where: { sittingId: SITTING_85 }, select: { exampleId: true, itemIndex: true, question: true, decision: true, candState: true, refState: true } });
const byKey = new Map(decided.map((d) => [`${d.exampleId}:${d.itemIndex}`, d]));
let carried = 0, carriedSame = 0, fresh = 0; const carry: Record<string, number> = {}; const freshDir: Record<string, number> = {};
for (const p of flips) {
  const d = byKey.get(`${p.exampleId}:${p.index}`);
  const dir = p.cand.pass ? "rc0 pass / ref fail" : "rc0 fail / ref pass";
  if (d && d.question.trim() === p.question.trim() && d.candState === pf(p.cand.pass) && d.refState === pf(p.ref.pass)) {
    carried++; carriedSame++;
    const k = `${dir} → Daniel ${d.decision}`; carry[k] = (carry[k] ?? 0) + 1;
  } else if (d && d.question.trim() === p.question.trim()) {
    // same item was adjudicated but rc0 sits on the other side of the reference than the incumbent did
    carried++; const k = `${dir} (incumbent was ${d.candState}) → Daniel ${d.decision}`; carry[k] = (carry[k] ?? 0) + 1;
  } else { fresh++; freshDir[dir] = (freshDir[dir] ?? 0) + 1; }
}
console.log(JSON.stringify({ rc0Run: RC0, flips: flips.length, carriedFrom85: carried, carriedSameSide: carriedSame, carry, fresh, freshDir }, null, 2));
await prisma.$disconnect(); process.exit(0);
