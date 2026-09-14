/**
 * PROTOTYPE — wayfinder #60. Prints the body that creates one arm of the
 * evidence-first experiment: the fixed 125 (the selections of 7337a398), the
 * incumbent judge, and a variant that is production's template byte for byte
 * with the `evidence-first` answer shape — so the only difference between the
 * arm and the control (05c9a31e, production shape) is the key order of each
 * checklist item under guided decoding.
 *
 *   npx tsx prototypes/60-evidence-first/variant60.ts <arm label>   → JSON on stdout
 */
import { prisma } from "../../src/db/prisma.js";
import { PRODUCTION_INSTRUMENT_TEMPLATE } from "../../src/services/visual-eval-instrument-templates.js";

const HELD_OUT = "7337a398-425c-40ed-8455-a8b4ff0d1ec4";
const JUDGE = "98d284fe-0993-462a-9991-df15442531cb"; // qwen3.8-27b-nvfp4 (thinking off, 3-node pool) — the vlm_eval row

async function main(): Promise<void> {
  const arm = process.argv[2] ?? "A";
  const selected = await prisma.vlmExperimentExampleSelection.findMany({
    where: { experimentId: HELD_OUT }, orderBy: { selectionOrder: "asc" }, select: { exampleId: true },
  });
  if (selected.length !== 125) throw new Error(`held-out set has ${selected.length} selections, expected 125`);
  const body = {
    name: `issue #60 evidence-first arm ${arm}: qwen3.8-27b-nvfp4 (thinking off) on the 125, production text, item keys question→detail→pass`,
    exampleIds: selected.map((s) => s.exampleId),
    modelIds: [JUDGE],
    judgePromptVariants: [{ id: "evidence-first", template: PRODUCTION_INSTRUMENT_TEMPLATE, responseShape: "evidence-first" }],
  };
  process.stdout.write(JSON.stringify(body));
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
