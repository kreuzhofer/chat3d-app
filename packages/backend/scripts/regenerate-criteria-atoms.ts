/**
 * Regenerate a prompt's verification criteria as requirement atoms (ADR 0002,
 * issue #89) for prompts whose criteria are bare strings, empty or null, and
 * mark their rated examples Stale by items so the re-rating batch takes them.
 *
 * Only the criteria change: the stored construction spec, interpretation,
 * checklist and eval plan stay, because the examples' code was generated from
 * them and the judge's specimen shows the spec. The old criteria are kept in
 * verification_criteria_previous; criteria_regenerated_at makes the run
 * resumable (a prompt with it set is skipped).
 *
 * Held-out prompts — any prompt with an example in the measurement set or a
 * spot-check sample — are never touched (Daniel, 2026-09-15): the grant, the
 * reference run and every screen compare on those items.
 *
 * Usage: npx tsx scripts/regenerate-criteria-atoms.ts [--dry-run] [--limit N] [--concurrency 4] [--out report.json]
 */
import { writeFileSync } from "fs";
import { prisma } from "../src/db/prisma.js";
import { generateSpec } from "../src/services/spec-generation.service.js";
import { runResearch } from "../src/services/research-agent.service.js";
import { enrichSpec } from "../src/services/spec-enrichment.service.js";
import { judgeAskable } from "../src/services/requirement-atoms.js";
import { HELD_OUT_EXPERIMENT_IDS } from "../src/services/training-export/judge-sft-held-out.js";
import { detectPromptOperations } from "../src/prompts/system-prompts.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("regen-criteria");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes("--dry-run");

type Kind = "bare" | "empty" | "null";
function kindOf(criteria: unknown): Kind | "atoms" {
  if (criteria == null) return "null";
  if (!Array.isArray(criteria)) return "bare";
  if (criteria.length === 0) return "empty";
  return typeof criteria[0] === "object" && criteria[0] !== null ? "atoms" : "bare";
}

interface Outcome {
  promptId: string; category: string; kind: Kind; examples: number; rated: number;
  status: "regenerated" | "failed" | "skipped";
  reason?: string; source?: "generator" | "enrichment";
  previousCount: number; atoms: number; askable: number; attempts: number;
}

async function main() {
  const limit = Number(arg("limit", "0"));
  const concurrency = Number(arg("concurrency", "4"));
  const out = arg("out", `regenerate-criteria-${new Date().toISOString().slice(0, 10)}.json`);

  // Held-out prompts: every prompt behind a row of the measurement set or a spot-check sample.
  const heldRows = await prisma.vlmExperimentExampleSelection.findMany({
    where: { experimentId: { in: [...HELD_OUT_EXPERIMENT_IDS] } }, select: { exampleId: true },
  });
  const heldPrompts = new Set((await prisma.workbenchExample.findMany({
    where: { id: { in: heldRows.map((r) => r.exampleId) } }, select: { promptId: true },
  })).map((e) => e.promptId));

  const candidates = (await prisma.workbenchExamplePrompt.findMany({
    where: { examples: { some: {} }, criteriaRegeneratedAt: null },
    select: {
      id: true, prompt: true, verificationCriteria: true, category: { select: { name: true } },
      examples: { select: { id: true, visualScore: true } },
    },
    orderBy: { id: "asc" },
  })).filter((p) => kindOf(p.verificationCriteria) !== "atoms" && !heldPrompts.has(p.id));
  const todo = limit > 0 ? candidates.slice(0, limit) : candidates;

  // Before/after: the approval status of every affected example at the start.
  const affectedIds = todo.flatMap((p) => p.examples.map((e) => e.id));
  const approvalBefore = await prisma.workbenchExample.groupBy({
    by: ["approvalStatus"], where: { id: { in: affectedIds } }, _count: { _all: true },
  });
  logger.info({ candidates: candidates.length, todo: todo.length, heldOutPrompts: heldPrompts.size, dryRun: DRY, approvalBefore }, "regenerating criteria as atoms");

  const outcomes: Outcome[] = [];
  let next = 0;
  async function one(p: typeof todo[number]): Promise<Outcome> {
    const kind = kindOf(p.verificationCriteria) as Kind;
    const previousCount = Array.isArray(p.verificationCriteria) ? p.verificationCriteria.length : 0;
    const base = { promptId: p.id, category: p.category.name, kind, examples: p.examples.length, rated: p.examples.filter((e) => e.visualScore != null).length, previousCount };
    const spec = await generateSpec(p.prompt);
    let atoms = spec.verificationCriteria;
    let source: "generator" | "enrichment" = "generator";
    let attempts = spec.criteriaFailure?.attempts ?? 1;
    if (atoms.length > 0) {
      const research = await runResearch({
        promptText: p.prompt, interpretation: spec.interpretation, semanticContext: spec.semanticContext,
        constructionSpec: spec.constructionSpec, complexity: spec.complexity,
        detectedOperations: detectPromptOperations(p.prompt, spec.interpretation),
      });
      if (research.knowledge.length > 0) {
        const enriched = await enrichSpec(spec, research);
        if (!enriched.criteriaFailure && enriched.verificationCriteria.length > 0) { atoms = enriched.verificationCriteria; source = "enrichment"; }
        attempts += enriched.criteriaFailure?.attempts ?? 1;
      }
    }
    if (atoms.length === 0) {
      const reason = spec.criteriaFailure ? `generator: ${spec.criteriaFailure.reasons.join(",")}` : "generator returned no spec (model-call error, fail-open)";
      logger.warn({ promptId: p.id, reason }, "criteria not regenerated");
      return { ...base, status: "failed", reason, atoms: 0, askable: 0, attempts };
    }
    if (!DRY) {
      await prisma.$transaction([
        prisma.workbenchExamplePrompt.update({
          where: { id: p.id },
          data: { verificationCriteriaPrevious: (p.verificationCriteria ?? null) as never, verificationCriteria: atoms as never, criteriaRegeneratedAt: new Date() },
        }),
        prisma.workbenchExample.updateMany({ where: { promptId: p.id, visualScore: { not: null } }, data: { ratingItemsStale: true } }),
      ]);
    }
    return { ...base, status: "regenerated", source, atoms: atoms.length, askable: judgeAskable(atoms).length, attempts };
  }
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const p = todo[next++];
      try {
        const o = await one(p); outcomes.push(o);
        logger.info({ n: outcomes.length, of: todo.length, promptId: p.id, status: o.status, source: o.source, atoms: o.atoms, askable: o.askable, attempts: o.attempts, reason: o.reason }, "prompt done");
      } catch (err) {
        outcomes.push({ promptId: p.id, category: p.category.name, kind: kindOf(p.verificationCriteria) as Kind, examples: p.examples.length, rated: 0, status: "failed", reason: `threw: ${err instanceof Error ? err.message : String(err)}`, previousCount: 0, atoms: 0, askable: 0, attempts: 0 });
        logger.error({ promptId: p.id, err }, "prompt threw");
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const done = outcomes.filter((o) => o.status === "regenerated");
  const n = done.length;
  const summary = {
    dryRun: DRY, candidates: candidates.length, attempted: todo.length, regenerated: n,
    failed: outcomes.filter((o) => o.status === "failed").length,
    failureReasons: outcomes.filter((o) => o.status === "failed").map((o) => `${o.promptId}: ${o.reason}`),
    bySource: { generator: done.filter((o) => o.source === "generator").length, enrichment: done.filter((o) => o.source === "enrichment").length },
    atomsPerPrompt: n ? done.reduce((a, o) => a + o.atoms, 0) / n : 0,
    askablePerPrompt: n ? done.reduce((a, o) => a + o.askable, 0) / n : 0,
    shareAtLeast3Askable: n ? done.filter((o) => o.askable >= 3).length / n : 0,
    previousPerPrompt: n ? done.reduce((a, o) => a + o.previousCount, 0) / n : 0,
    examplesMarkedStale: done.reduce((a, o) => a + o.rated, 0),
    approvalBefore,
  };
  writeFileSync(out, JSON.stringify({ summary, outcomes }, null, 2));
  logger.info({ ...summary, failureReasons: summary.failureReasons.length, out }, "regeneration finished");
  await prisma.$disconnect();
}

main().catch((err) => { logger.error({ err }, "regeneration failed"); process.exit(1); });
