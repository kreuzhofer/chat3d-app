/**
 * Backfill the code reviewer's item answers on rows that have none
 * (ADR 0001, issue #105). Runs the code review only — no judge, no render —
 * and writes `code_checklist_results`; scores and the visual answers are
 * untouched. The gate is then re-derived by scripts/rederive-gate.ts.
 *
 *   npx tsx scripts/backfill-code-items.ts [--experiment <id>] [--limit N] [--concurrency N] [--apply]
 *
 * Frame: production rows, rendered, rated, with a prompt that carries at
 * least one code-routed criterion, and no code answers stored yet. With
 * --experiment, only the rows of that experiment's example selections (the
 * 125 of 7337a398 for the measurement). Dry run lists the frame; --apply
 * calls the reviewer and writes.
 */
import { prisma } from "../src/db/prisma.js";
import { Prisma } from "@prisma/client";
import { evaluateCode } from "../src/services/code-eval.service.js";
import { toAnnotatedCriteria, codeOnlyCriteria } from "../src/utils/verification-criteria.js";
import type { CodeAssertion } from "../src/services/spec-generation.service.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes("--apply");
const experimentId = flag("--experiment");
const limit = Number(flag("--limit") ?? 0) || undefined;
const concurrency = Number(flag("--concurrency") ?? 2) || 2;

async function main(): Promise<void> {
  const selected = experimentId
    ? (await prisma.vlmExperimentExampleSelection.findMany({ where: { experimentId }, select: { exampleId: true } })).map((s) => s.exampleId)
    : undefined;
  const rows = await prisma.workbenchExample.findMany({
    where: {
      experimentRunId: null, renderStatus: "success", vlmInstrumentId: { not: null }, codeChecklistResults: { equals: Prisma.DbNull },
      ...(selected ? { id: { in: selected } } : {}),
    },
    select: { id: true, code: true, promptRef: { select: { prompt: true, specInterpretation: true, constructionSpec: true, codeAssertions: true, verificationCriteria: true } } },
    orderBy: { createdAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  const targets = rows.filter((r) => codeOnlyCriteria(r.promptRef.verificationCriteria).length > 0);
  console.log(`frame: ${rows.length} rows without code answers${selected ? ` in experiment ${experimentId}` : ""}; ${targets.length} carry code-routed criteria`);
  if (!apply) { console.log("dry run — pass --apply to call the reviewer and write"); return; }

  let done = 0, failed = 0, unanswered = 0, itemsWritten = 0;
  const queue = targets.slice();
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const criteria = toAnnotatedCriteria(r.promptRef.verificationCriteria);
        const result = await evaluateCode({
          userPrompt: r.promptRef.prompt,
          code: r.code,
          specInterpretation: r.promptRef.specInterpretation ?? undefined,
          codeAssertions: (r.promptRef.codeAssertions as CodeAssertion[] | null) ?? undefined,
          constructionSpec: r.promptRef.constructionSpec ?? undefined,
          annotatedCriteria: criteria,
        });
        await prisma.workbenchExample.update({ where: { id: r.id }, data: { codeChecklistResults: result.itemResults as unknown as undefined } });
        done++; itemsWritten += result.itemResults.length; unanswered += result.itemResults.filter((i) => i.pass === null).length;
        if (done % 10 === 0) console.log(`  ${done}/${targets.length} rows, ${itemsWritten} items, ${unanswered} unanswered, ${failed} failed`);
      } catch (error) {
        failed++;
        console.error(`row ${r.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`applied: ${done} rows, ${itemsWritten} item answers (${unanswered} unanswered), ${failed} failed`);
}

// The reviewer's imports leave handles open (semaphores, timers): exit explicitly.
main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
