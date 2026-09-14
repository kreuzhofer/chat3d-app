/**
 * Re-derive the approval verdict from the stored item answers (ADR 0001,
 * issue #88). Dry run by default; `--apply` writes.
 *
 *   npx tsx scripts/rederive-gate.ts [--apply] [--threshold 7.5]
 *
 * Frame: production rows (no experiment run), rendered, rated under some
 * instrument, whose status the judge derived (auto_approved or pending). A
 * human decision (human_approved, rejected with a note) is never touched;
 * a row the pipeline rejected before the judge has no items and stays out.
 * The verdict is recomputed by deriveVerdict() from the row's own stored
 * items, score and assertion outcome — re-derived, never re-rated — and the
 * gate version is stamped on every row in the frame, changed or not.
 */
import { prisma } from "../src/db/prisma.js";
import { deriveVerdict, gateItems, GATE_VERSION, type GateItem } from "../src/services/approval-gate.service.js";
import { getAutoApproveThreshold } from "../src/services/generation-settings.service.js";

const apply = process.argv.includes("--apply");
const thrArg = process.argv.indexOf("--threshold");

async function main(): Promise<void> {
  const threshold = thrArg >= 0 ? Number(process.argv[thrArg + 1]) : await getAutoApproveThreshold("workbench");
  const rows = await prisma.workbenchExample.findMany({
    where: { experimentRunId: null, renderStatus: "success", vlmInstrumentId: { not: null }, approvalStatus: { in: ["auto_approved", "pending"] } },
    select: { id: true, approvalStatus: true, evalScore: true, assertionPassRate: true, evalChecklistResults: true, codeChecklistResults: true, gateVersion: true },
  });
  const transitions = new Map<string, number>();
  const reasons = new Map<string, number>();
  const changes: Array<{ id: string; status: string }> = [];
  let alreadyStamped = 0;
  for (const r of rows) {
    const visual = Array.isArray(r.evalChecklistResults) ? (r.evalChecklistResults as GateItem[]) : [];
    const code = Array.isArray(r.codeChecklistResults) ? (r.codeChecklistResults as GateItem[]) : [];
    const items = gateItems(visual, code);
    const v = deriveVerdict({
      renderSuccess: true,
      assertionsFailed: r.assertionPassRate !== null && Number(r.assertionPassRate) < 1,
      items,
      compositeScore: r.evalScore === null ? null : Number(r.evalScore),
      threshold,
    });
    const key = `${r.approvalStatus} → ${v.status}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    if (v.status !== r.approvalStatus) reasons.set(`${key} (${v.reason})`, (reasons.get(`${key} (${v.reason})`) ?? 0) + 1);
    if (r.gateVersion === GATE_VERSION) alreadyStamped++;
    if (v.status !== r.approvalStatus) changes.push({ id: r.id, status: v.status });
  }
  console.log(`gate ${GATE_VERSION} | threshold ${threshold} | frame ${rows.length} rows | already stamped ${alreadyStamped}`);
  for (const [k, n] of [...transitions].sort()) console.log(`  ${k}: ${n}`);
  console.log("changes by reason:");
  for (const [k, n] of [...reasons].sort()) console.log(`  ${k}: ${n}`);
  console.log(`changed verdicts: ${changes.length}`);
  if (!apply) { console.log("dry run — pass --apply to write"); return; }

  let written = 0;
  for (const c of changes) {
    await prisma.workbenchExample.update({ where: { id: c.id }, data: { approvalStatus: c.status, gateVersion: GATE_VERSION } });
    written++;
  }
  const stamped = await prisma.workbenchExample.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, OR: [{ gateVersion: null }, { gateVersion: { not: GATE_VERSION } }] },
    data: { gateVersion: GATE_VERSION },
  });
  console.log(`applied: ${written} verdicts changed, ${stamped.count} further rows stamped ${GATE_VERSION}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
