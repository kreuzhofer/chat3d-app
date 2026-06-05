/**
 * One-shot: regenerate spec for each prompt in the test-set file.
 * Each regen overwrites the prompt's spec fields, including the new evalPlan.
 *
 * Usage: npx tsx scripts/eval-plan-regen-specs.ts <test-set-file>
 */
import { readFileSync } from "fs";
import { prisma } from "../src/db/prisma.js";
import { generateSpec } from "../src/services/spec-generation.service.js";
import { persistSpecToPrompt } from "../src/services/workbench-spec-persist.service.js";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/eval-plan-regen-specs.ts <test-set-file>");
    process.exit(1);
  }
  const ids = readFileSync(path, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  let withEvalPlan = 0;
  let withoutEvalPlan = 0;
  let failed = 0;
  let skipped = 0;

  for (const id of ids) {
    const prompt = await prisma.workbenchExamplePrompt.findUnique({ where: { id } });
    if (!prompt) {
      console.log(`SKIP: ${id} not found`);
      skipped++;
      continue;
    }
    try {
      const spec = await generateSpec(prompt.prompt);
      await persistSpecToPrompt({
        promptId: id,
        specResult: spec,
        specCameFromNullDecompositionCache: false,
      });
      const has = spec.evalPlan ? "yes" : "no";
      if (spec.evalPlan) withEvalPlan++;
      else withoutEvalPlan++;
      console.log(`Regenerated: ${id}  evalPlan=${has}`);
    } catch (err) {
      failed++;
      console.log(
        `FAIL: ${id}  ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(
    `\nWith evalPlan: ${withEvalPlan}; without: ${withoutEvalPlan}; failed: ${failed}; skipped: ${skipped}`,
  );
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
