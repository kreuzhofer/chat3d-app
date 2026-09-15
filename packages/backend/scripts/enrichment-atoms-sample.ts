/**
 * Sample measurement for issue #104: drive prompts through spec generation,
 * research and enrichment WITHOUT persisting, and report the atoms contract's
 * numbers before #89 regenerates the corpus.
 *
 * Per prompt: rough atoms (pass 1), enriched atoms, judge-askable atoms
 * (visibility != code), attempts, failure reason. Totals: atoms per prompt,
 * askable per prompt, share at >= 3 askable (the gate's eligibility),
 * bare-string / contract failure rate.
 *
 * Usage: npx tsx scripts/enrichment-atoms-sample.ts [--size 20] [--seed 104] [--concurrency 4] [--out file.json]
 * Draws prompts whose research finds knowledge (enrichment runs only then);
 * prompts without knowledge are reported as skipped and redrawn. Prompts run
 * `concurrency` at a time — this is not a judge pair, so N ≤ R does not apply;
 * the provider semaphore still caps calls in flight.
 */
import { writeFileSync } from "fs";
import { prisma } from "../src/db/prisma.js";
import { generateSpec } from "../src/services/spec-generation.service.js";
import { runResearch } from "../src/services/research-agent.service.js";
import { enrichSpec } from "../src/services/spec-enrichment.service.js";
import { judgeAskable } from "../src/services/spec-enrichment-atoms.js";
import { detectPromptOperations } from "../src/prompts/system-prompts.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("enrichment-sample");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Deterministic shuffle so a re-run draws the same prompts. */
function seededOrder<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

interface Row {
  promptId: string; category: string | null; prompt: string;
  roughAtoms: number; roughAskable: number;
  enrichedAtoms: number; enrichedAskable: number;
  attempts: number; failure: string | null;
  enriched: Array<{ text: string; visibility: string }>;
}

async function main() {
  const size = Number(arg("size", "20"));
  const seed = Number(arg("seed", "104"));
  const out = arg("out", `enrichment-atoms-sample-${seed}.json`);

  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { examples: { some: { approvalStatus: { in: ["approved", "auto_approved", "human_approved"] } } } },
    select: { id: true, prompt: true, category: { select: { name: true } } },
  });
  const order = seededOrder(prompts, seed);
  logger.info({ candidates: prompts.length, size, seed }, "drawing prompts with approved examples");

  const rows: Row[] = [];
  let skippedNoKnowledge = 0;
  let next = 0;
  const concurrency = Number(arg("concurrency", "4"));

  async function measure(p: typeof order[number]): Promise<Row | null> {
    const spec = await generateSpec(p.prompt);
    const research = await runResearch({
      promptText: p.prompt, interpretation: spec.interpretation, semanticContext: spec.semanticContext,
      constructionSpec: spec.constructionSpec, complexity: spec.complexity,
      detectedOperations: detectPromptOperations(p.prompt, spec.interpretation),
    });
    if (research.knowledge.length === 0) { skippedNoKnowledge++; logger.info({ promptId: p.id }, "no knowledge; enrichment would not run — redrawn"); return null; }
    const enriched = await enrichSpec(spec, research);
    return {
      promptId: p.id, category: p.category?.name ?? null, prompt: p.prompt.slice(0, 120),
      roughAtoms: spec.verificationCriteria.length, roughAskable: judgeAskable(spec.verificationCriteria).length,
      enrichedAtoms: enriched.verificationCriteria.length, enrichedAskable: judgeAskable(enriched.verificationCriteria).length,
      attempts: enriched.criteriaFailure ? enriched.criteriaFailure.attempts : 1,
      failure: enriched.criteriaFailure ? enriched.criteriaFailure.reasons.join(",") : null,
      enriched: enriched.verificationCriteria,
    };
  }

  // A bounded worker pool: each worker takes the next undrawn prompt until
  // `size` rows exist. A few extra prompts may be measured at the end.
  async function worker(): Promise<void> {
    while (rows.length < size && next < order.length) {
      const p = order[next++];
      const row = await measure(p);
      if (!row) continue;
      rows.push(row);
      logger.info({ n: rows.length, promptId: p.id, rough: `${row.roughAskable}/${row.roughAtoms}`, enriched: `${row.enrichedAskable}/${row.enrichedAtoms}`, attempts: row.attempts, failure: row.failure }, "prompt measured");
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const n = rows.length;
  const mean = (f: (r: Row) => number) => n ? rows.reduce((a, r) => a + f(r), 0) / n : 0;
  const summary = {
    seed, size: n, skippedNoKnowledge,
    roughAtomsPerPrompt: mean((r) => r.roughAtoms), roughAskablePerPrompt: mean((r) => r.roughAskable),
    enrichedAtomsPerPrompt: mean((r) => r.enrichedAtoms), enrichedAskablePerPrompt: mean((r) => r.enrichedAskable),
    shareAtLeast3Askable: n ? rows.filter((r) => r.enrichedAskable >= 3).length / n : 0,
    roughShareAtLeast3Askable: n ? rows.filter((r) => r.roughAskable >= 3).length / n : 0,
    firstReplyAccepted: n ? rows.filter((r) => r.attempts === 1 && !r.failure).length / n : 0,
    retriedThenAccepted: n ? rows.filter((r) => r.attempts === 2 && !r.failure).length / n : 0,
    failedAfterRetry: n ? rows.filter((r) => r.failure).length / n : 0,
    failureReasons: rows.filter((r) => r.failure).map((r) => r.failure),
  };
  writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
  logger.info({ ...summary, out }, "sample measured");
  await prisma.$disconnect();
}

main().catch((err) => { logger.error({ err }, "sample failed"); process.exit(1); });
