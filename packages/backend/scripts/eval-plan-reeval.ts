/**
 * One-shot: re-evaluate the best existing example for each prompt in the
 * eval-plan A/B test-set file. Picks the highest-evalScore success example
 * per prompt and runs the full re-eval pipeline against it.
 *
 * Usage: npx tsx scripts/eval-plan-reeval.ts <test-set-file>
 */
import { readFileSync } from "fs";
import { prisma } from "../src/db/prisma.js";
import { reEvaluateExample } from "../src/services/workbench-reeval.service.js";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/eval-plan-reeval.ts <test-set-file>");
    process.exit(1);
  }
  const ids = readFileSync(path, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const promptId of ids) {
    const best = await prisma.workbenchExample.findFirst({
      where: { promptId, renderStatus: "success" },
      orderBy: [{ evalScore: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!best) {
      console.log(`SKIP: ${promptId} (no successful example)`);
      skipped++;
      continue;
    }
    try {
      const res = await reEvaluateExample(best.id);
      ok++;
      console.log(
        `Re-evaluated: ${promptId}  example=${best.id}  evalScore=${res.evalScore} source=${res.source}`,
      );
    } catch (err) {
      fail++;
      console.log(
        `FAIL: ${promptId}  example=${best.id}  ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`\nOK: ${ok}; FAIL: ${fail}; SKIPPED: ${skipped}`);
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
