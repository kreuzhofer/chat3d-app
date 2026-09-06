/**
 * The qualification screen (ADR 0004, issue #61): prints every mechanical
 * term of the bar as PASS / FAIL for a candidate judge's run(s) against one
 * reference run under the same Instrument id, and writes the disagreement
 * dump the adjudication works from.
 *
 *   docker compose exec -T backend npx tsx scripts/qualification-screen.ts \
 *     --candidate <run id> [--candidate <run id of the second arm>] \
 *     --reference <run id> [--dump <path.md>] [--corpus <rated rows>]
 *
 * Runs are `experiment_runs` ids. The selected examples are the candidate
 * experiment's selections. With two candidate runs the stability pair is
 * screened (arm 2 against arm 1); with one, stability is reported as not
 * run. The corpus size for hours-per-pass defaults to the rated corpus.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/db/prisma.js";
import { getInstrumentStatus } from "../src/services/workbench-instrument.service.js";
import {
  agreement,
  completeness,
  identity,
  itemGate,
  pairItems,
  scoreAgreement,
  stability,
  throughput,
  type AgreementTerms,
  type ScreenResultRow,
  type ScreenRun,
  type StoredChecklistItem,
  type Term,
} from "../src/services/qualification-screen.service.js";
import { disagreements, renderDisagreementDump } from "../src/services/qualification-screen-dump.js";

interface Args { candidates: string[]; reference: string; dump?: string; corpus?: number }

function parseArgs(argv: string[]): Args {
  const args: Args = { candidates: [], reference: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--candidate") { args.candidates.push(v); i++; }
    else if (a === "--reference") { args.reference = v; i++; }
    else if (a === "--dump") { args.dump = v; i++; }
    else if (a === "--corpus") { args.corpus = Number(v); i++; }
    else throw new Error(`Unknown argument ${a}`);
  }
  if (args.candidates.length < 1 || args.candidates.length > 2) throw new Error("Give one or two --candidate run ids");
  if (!args.reference) throw new Error("--reference is required");
  return args;
}

interface LoadedRun extends ScreenRun { experimentId: string; wallClockMs: number | null }

async function loadRun(runId: string): Promise<LoadedRun> {
  const run = await prisma.experimentRun.findUnique({
    where: { id: runId },
    select: { id: true, modelLabel: true, experimentId: true, startedAt: true, completedAt: true, status: true },
  });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "completed") throw new Error(`Run ${runId} is ${run.status}, not completed`);
  const results = await prisma.vlmExperimentResult.findMany({
    where: { runId },
    select: {
      exampleId: true, visualScore: true, checklistResults: true, error: true, issues: true,
      instrumentId: true, thinkingEffort: true, durationMs: true, completionTokens: true,
    },
  });
  const rows: ScreenResultRow[] = results.map((r) => ({
    exampleId: r.exampleId,
    visualScore: r.visualScore == null ? null : Number(r.visualScore),
    checklistResults: Array.isArray(r.checklistResults) ? (r.checklistResults as StoredChecklistItem[]) : null,
    error: r.error,
    issues: Array.isArray(r.issues) ? (r.issues as unknown[]).map(String) : [],
    instrumentId: r.instrumentId,
    thinkingEffort: r.thinkingEffort,
    durationMs: r.durationMs,
    completionTokens: r.completionTokens,
  }));
  const wallClockMs = run.startedAt && run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null;
  return { runId, label: run.modelLabel, rows, experimentId: run.experimentId, wallClockMs };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const mark = (pass: boolean) => (pass ? "PASS" : "FAIL");

function printTerms(terms: Term[]): void {
  for (const t of terms) {
    const isRate = t.limit < 1 && t.limit > 0;
    const value = isRate ? pct(t.value) : String(t.value);
    const limit = isRate ? pct(t.limit) : String(t.limit);
    console.log(`  ${mark(t.pass)}  ${t.name}: ${value} (${t.comparator} ${limit})`);
  }
}

function printAgreement(label: string, a: AgreementTerms): void {
  console.log(`  ${label}: items ${a.items} | identical ${pct(a.identicalRate)} | hard flips ${pct(a.hardFlipRate)} (${a.hardFlips}) | ` +
    `either uncertain ${a.eitherUncertain} | pass rate ref ${pct(a.items ? a.refPass / a.items : 0)} cand ${pct(a.items ? a.candPass / a.items : 0)}`);
  console.log(`    ref \\ cand      P      F      U`);
  for (const r of ["P", "F", "U"] as const) {
    console.log(`    ${r.padStart(10)}   ${String(a.matrix[r].P).padStart(4)}   ${String(a.matrix[r].F).padStart(4)}   ${String(a.matrix[r].U).padStart(4)}`);
  }
  console.log(`    raw false passes (cand pass, ref fail) ${a.candPassOnRefFail} of ${a.refFail} ref fails (${pct(a.refFail ? a.candPassOnRefFail / a.refFail : 0)}) | ` +
    `raw false fails (cand fail, ref pass) ${a.candFailOnRefPass} of ${a.refPass} ref passes (${pct(a.refPass ? a.candFailOnRefPass / a.refPass : 0)})`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [arm1, arm2] = await Promise.all(args.candidates.map(loadRun));
  const ref = await loadRun(args.reference);
  const selected = (await prisma.vlmExperimentExampleSelection.findMany({
    where: { experimentId: arm1.experimentId }, orderBy: { selectionOrder: "asc" }, select: { exampleId: true },
  })).map((s) => s.exampleId);
  const status = await getInstrumentStatus();
  const corpus = args.corpus ?? status.rated;

  console.log(`QUALIFICATION SCREEN — ADR 0004 mechanical terms`);
  console.log(`candidate arm 1: ${arm1.label} (${arm1.runId})`);
  if (arm2) console.log(`candidate arm 2: ${arm2.label} (${arm2.runId})`);
  console.log(`reference:       ${ref.label} (${ref.runId})`);
  console.log(`examples selected: ${selected.length} | current instrument: ${status.instrumentId} | corpus for hours-per-pass: ${corpus} rated rows`);

  console.log(`\n## IDENTITY — one Instrument id and one thinking effort per run, the same id across runs`);
  const ids = [arm1, arm2, ref].filter((r): r is LoadedRun => !!r).map((r) => ({ r, i: identity(r) }));
  for (const { r, i } of ids) console.log(`  ${mark(i.pass)}  ${r.label}: instrument ${i.instrumentIds.join(", ")} | effort ${i.thinkingEfforts.join(", ")}`);
  const sameId = new Set(ids.flatMap(({ i }) => i.instrumentIds)).size === 1;
  console.log(`  ${mark(sameId)}  same instrument id across runs`);
  const identityPass = sameId && ids.every(({ i }) => i.pass);

  console.log(`\n## COMPLETENESS — zero tolerance (ADR 0004)`);
  console.log(`  (unreadable follow-ups are read from the item's zoom outcome marker; rows stored before 2026-09-06 carry none, so for those the count is blind and the log is the record)`);
  const completenessPass: boolean[] = [];
  for (const r of [arm1, arm2].filter((x): x is LoadedRun => !!x)) {
    const c = completeness(r, selected, ref);
    completenessPass.push(c.pass);
    console.log(`  ${r.label}: answered ${c.answered}/${c.selected}, items ${c.items}, residual uncertain ${c.residualUncertain} (allowed; they fail at the gate)`);
    printTerms(c.terms);
  }
  const rc = completeness(ref, selected, arm1);
  console.log(`  reference ${ref.label} (recorded): answered ${rc.answered}/${rc.selected}, items ${rc.items}, residual uncertain ${rc.residualUncertain}, ` +
    `${rc.terms.filter((t) => !t.pass).map((t) => `${t.name} ${t.value}`).join(", ") || "all six counts zero"}`);

  console.log(`\n## STABILITY — arm 2 vs arm 1, at or inside the reference's floor`);
  let stabilityPass: boolean | null = null;
  if (arm2) {
    const s = stability(arm1, arm2);
    stabilityPass = s.pass;
    printTerms(s.terms);
    printAgreement("all items (gating)", s.allItems);
    printAgreement("first pass (zoom-resolved re-opened; the floor's own cut)", s.firstPass);
  } else {
    console.log(`  NOT RUN — one candidate run given; the term needs the second arm`);
  }

  console.log(`\n## THROUGHPUT — recorded, not gating`);
  for (const r of [arm1, arm2, ref].filter((x): x is LoadedRun => !!x)) {
    const t = throughput(r, corpus, r.wallClockMs ?? undefined);
    console.log(`  ${r.label}: ${t.secondsPerExample.toFixed(1)} s per example, ${t.outputTokensPerExample.toFixed(0)} output tokens | ` +
      `wall clock ${t.wallClockMinutes?.toFixed(1) ?? "?"} min for ${t.examples} | corpus pass ${t.hoursPerCorpusSequential.toFixed(1)} h sequential` +
      (t.hoursPerCorpusAtRunRate != null ? `, ${t.hoursPerCorpusAtRunRate.toFixed(1)} h at the run's own rate` : ""));
  }

  console.log(`\n## RAW AGREEMENT with the reference — recorded, not gating; produces the disagreement set`);
  for (const r of [arm1, arm2].filter((x): x is LoadedRun => !!x)) {
    const pairs = pairItems(r, ref);
    printAgreement(`${r.label} vs reference, all items`, agreement(pairs));
    const fp = agreement(pairs, { firstPass: true });
    console.log(`  first pass: identical ${pct(fp.identicalRate)} | hard flips ${pct(fp.hardFlipRate)} (${fp.hardFlips}) | either uncertain ${fp.eitherUncertain}`);
    const g = itemGate(r, ref);
    console.log(`  item gate (ADR 0001): eligible ${g.eligible} | verdicts agree ${g.agree} (${pct(g.agreeRate)}) | false accepts ${g.falseAccepts} | ` +
      `false rejects ${g.falseRejects} | approves cand ${g.candApproves} ref ${g.refApproves}`);
    const s = scoreAgreement(r, ref);
    console.log(`  scores (first pass): same ${pct(s.examples ? s.sameScore / s.examples : 0)} | mean abs delta ${s.meanAbsDelta.toFixed(3)} | ` +
      `mean cand ${s.candMean.toFixed(2)} ref ${s.refMean.toFixed(2)} | backstop 7.5 disagreements ${s.candPassRefFail + s.candFailRefPass} ` +
      `(cand pass/ref fail ${s.candPassRefFail}, cand fail/ref pass ${s.candFailRefPass})`);
  }

  const mechanical = identityPass && completenessPass.every(Boolean) && stabilityPass === true;
  console.log(`\n## MECHANICAL SCREEN: ${stabilityPass === null ? "INCOMPLETE (stability not run)" : mark(mechanical)}`);
  console.log(`  adjudicated terms are decided from the dump, by a human (ADR 0004).`);

  if (args.dump) {
    const rows = disagreements(arm1, ref, arm2);
    const examples = await prisma.workbenchExample.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.exampleId))] } },
      select: { id: true, promptRef: { select: { prompt: true, category: { select: { name: true } } } } },
    });
    const prompts = new Map(examples.map((e) => [e.id, { prompt: e.promptRef.prompt, category: e.promptRef.category.name }]));
    const md = renderDisagreementDump(rows, {
      candidateLabel: arm1.label, referenceLabel: ref.label, arm2Label: arm2?.label,
      instrumentId: identity(arm1).instrumentIds.join(","), prompts,
    });
    writeFileSync(args.dump, md);
    console.log(`\ndisagreement dump: ${rows.length} items on ${prompts.size} examples → ${args.dump}`);
  }
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  // Imported services keep handles open (the instrument status pulls in the
  // eval pipeline); a one-shot CLI exits explicitly once its output is written.
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
