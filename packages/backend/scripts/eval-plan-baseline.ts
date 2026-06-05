/**
 * Captures best-example metrics for each prompt in the eval-plan A/B test set.
 *
 * Reads docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt and writes a
 * pipe-delimited TSV to the path passed via argv[2] (defaults to
 * /tmp/eval-plan-baseline.tsv).
 *
 * Columns: prompt_id | eval_score | visual_score | code_eval_score | eval_source | composite_weight_source
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db/prisma.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const inPath = resolve(
    __dirname,
    "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt",
  );
  const outPath = process.argv[2] ?? "/tmp/eval-plan-baseline.tsv";

  const ids = readFileSync(inPath, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const rows: string[] = [];
  let missingCount = 0;
  for (const promptId of ids) {
    const best = await prisma.workbenchExample.findFirst({
      where: { promptId, renderStatus: "success" },
      orderBy: [{ evalScore: "desc" }, { createdAt: "desc" }],
      select: {
        evalScore: true,
        visualScore: true,
        codeEvalScore: true,
        evalSource: true,
        compositeWeightSource: true,
      },
    });
    if (!best) {
      missingCount++;
      rows.push(`${promptId}|||||`);
      continue;
    }
    rows.push(
      [
        promptId,
        best.evalScore?.toString() ?? "",
        best.visualScore?.toString() ?? "",
        best.codeEvalScore?.toString() ?? "",
        best.evalSource ?? "",
        best.compositeWeightSource ?? "",
      ].join("|"),
    );
  }
  writeFileSync(outPath, rows.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${rows.length} rows to ${outPath} (${missingCount} missing)`);
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
