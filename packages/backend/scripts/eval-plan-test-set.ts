/**
 * One-shot script: picks ~30 prompt IDs spanning the dimensions defined in the
 * spec's A/B test methodology section. Writes the IDs (one per line) to
 * docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt.
 *
 * Run with: npx tsx scripts/eval-plan-test-set.ts
 */
import { prisma } from "../src/db/prisma.js";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Bucket {
  categoryNameLike: string;
  count: number;
}

const BUCKETS: Bucket[] = [
  { categoryNameLike: "PCB", count: 8 },
  { categoryNameLike: "Primitives", count: 4 },
  { categoryNameLike: "Boolean Operations", count: 4 },
  { categoryNameLike: "Hinges", count: 4 },
  { categoryNameLike: "Generic Enclosures", count: 4 },
  { categoryNameLike: "bd_warehouse", count: 3 },
  { categoryNameLike: "Extrusions", count: 3 },
];

async function pickPromptsForBucket(b: Bucket): Promise<string[]> {
  const rows = await prisma.workbenchExamplePrompt.findMany({
    where: {
      category: { name: { contains: b.categoryNameLike, mode: "insensitive" } },
      examples: { some: { renderStatus: "success" } },
    },
    select: {
      id: true,
      examples: { select: { approvalStatus: true } },
    },
    orderBy: { id: "asc" },
  });

  // Mix approval statuses: pick some auto_approved, some pending, some rejected.
  const statusOf = (r: typeof rows[number]) => {
    const has = (s: string) => r.examples.some((e) => e.approvalStatus === s);
    if (has("rejected")) return "rejected";
    if (has("auto_approved")) return "auto_approved";
    return "pending";
  };

  const grouped: Record<string, string[]> = { auto_approved: [], pending: [], rejected: [] };
  for (const r of rows) grouped[statusOf(r)].push(r.id);

  const out: string[] = [];
  const order = ["pending", "auto_approved", "rejected"];
  let i = 0;
  while (out.length < b.count && order.some((s) => grouped[s].length > 0)) {
    const s = order[i % order.length];
    const next = grouped[s].shift();
    if (next) out.push(next);
    i++;
  }
  return out;
}

async function main() {
  const allIds: string[] = [];
  for (const b of BUCKETS) {
    const ids = await pickPromptsForBucket(b);
    console.log(`${b.categoryNameLike}: picked ${ids.length}/${b.count}`);
    allIds.push(...ids);
  }
  const outPath = resolve(__dirname, "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt");
  writeFileSync(outPath, allIds.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${allIds.length} IDs to ${outPath}`);
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
