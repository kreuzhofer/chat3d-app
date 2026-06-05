/**
 * Reads /tmp/eval-plan-v1-baseline.tsv (state after v1 regen+reeval earlier
 * today) and /tmp/eval-plan-v2-after.tsv (state after v2 regen+reeval with
 * the new assembly/mechanism band), joins on prompt_id, and writes a
 * markdown report comparing v1 → v2 for the 30-prompt eval-plan test set.
 *
 * Also queries the DB for the v2 suggestedCodeWeight values per prompt so
 * we can compute per-bucket weight-band distributions.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { prisma } from "../src/db/prisma.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Row {
  promptId: string;
  evalScore: number | null;
  visualScore: number | null;
  codeScore: number | null;
  evalSource: string | null;
  weightSource: string | null;
}

function parseTsv(path: string): Map<string, Row> {
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  const map = new Map<string, Row>();
  for (const line of lines) {
    const [pid, es, vs, cs, src, ws] = line.split("|");
    map.set(pid, {
      promptId: pid,
      evalScore: es ? Number(es) : null,
      visualScore: vs ? Number(vs) : null,
      codeScore: cs ? Number(cs) : null,
      evalSource: src || null,
      weightSource: ws || null,
    });
  }
  return map;
}

function gap(a: number | null, b: number | null): string {
  if (a === null || b === null) return "-";
  return Math.abs(a - b).toFixed(1);
}

// Buckets in the order they appear in the test-set file (sequential picks).
interface Bucket {
  name: string;
  startIdx: number; // 0-based, inclusive
  endIdx: number;   // 0-based, inclusive
}
const BUCKETS: Bucket[] = [
  { name: "PCB Cases",          startIdx: 0,  endIdx: 7  },
  { name: "Primitives",         startIdx: 8,  endIdx: 11 },
  { name: "Boolean Operations", startIdx: 12, endIdx: 15 },
  { name: "Hinges",             startIdx: 16, endIdx: 19 },
  { name: "Generic Enclosures", startIdx: 20, endIdx: 23 },
  { name: "bd_warehouse",       startIdx: 24, endIdx: 26 },
  { name: "Extrusions",         startIdx: 27, endIdx: 29 },
];

function band(w: number | null): string {
  if (w === null || Number.isNaN(w)) return "n/a";
  if (w < 0.45) {
    // 0.20-0.40 visual vs 0.30-0.45 mechanism — they overlap.
    // Treat 0.20-0.295 as visual, 0.30-0.449 as visual-or-mechanism
    // For reporting purposes we lump them as "visual/assembly (<0.45)".
    return "visual/assembly (0.20–0.45)";
  }
  if (w < 0.70) return "balanced (0.45–0.70)";
  return "sealed/code-heavy (0.70+)";
}

async function main() {
  const testSetPath = resolve(__dirname, "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt");
  const ids = readFileSync(testSetPath, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const before = parseTsv("/tmp/eval-plan-v1-baseline.tsv");
  const after = parseTsv("/tmp/eval-plan-v2-after.tsv");

  // Pull v2 evalPlan weights for each prompt from the DB.
  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { id: { in: ids } },
    select: { id: true, evalPlan: true },
  });
  const weights = new Map<string, number | null>();
  for (const p of prompts) {
    const ep = p.evalPlan as { suggestedCodeWeight?: number } | null;
    const w = ep && typeof ep.suggestedCodeWeight === "number" ? ep.suggestedCodeWeight : null;
    weights.set(p.id, w);
  }

  // Per-prompt rows (keep test-set ordering).
  const rows: string[] = [];
  rows.push("| Prompt (first 8) | Bucket | v2 weight | v2 band | v1 composite | v2 composite | Δ | v1 |v-c| | v2 |v-c| | v1 src | v2 src |");
  rows.push("|---|---|---|---|---|---|---|---|---|---|---|");

  let totalDelta = 0;
  let countDelta = 0;
  const upCount = { count: 0 };
  const downCount = { count: 0 };
  const sameCount = { count: 0 };

  // For per-bucket aggregation.
  const bucketStats: Record<string, {
    n: number;
    v1Sum: number; v1Count: number;
    v2Sum: number; v2Count: number;
    deltaSum: number; deltaCount: number;
    minDelta: number; maxDelta: number;
    weightSum: number; weightCount: number;
    bandCounts: Record<string, number>;
  }> = {};
  for (const b of BUCKETS) {
    bucketStats[b.name] = {
      n: b.endIdx - b.startIdx + 1,
      v1Sum: 0, v1Count: 0,
      v2Sum: 0, v2Count: 0,
      deltaSum: 0, deltaCount: 0,
      minDelta: Number.POSITIVE_INFINITY,
      maxDelta: Number.NEGATIVE_INFINITY,
      weightSum: 0, weightCount: 0,
      bandCounts: {},
    };
  }

  function bucketFor(idx: number): Bucket | null {
    for (const b of BUCKETS) {
      if (idx >= b.startIdx && idx <= b.endIdx) return b;
    }
    return null;
  }

  for (let i = 0; i < ids.length; i++) {
    const pid = ids[i];
    const b = before.get(pid);
    const a = after.get(pid);
    const w = weights.get(pid) ?? null;
    const bucket = bucketFor(i);
    const bucketName = bucket?.name ?? "?";
    const bandLabel = band(w);

    if (!b || !a) {
      rows.push(`| \`${pid.slice(0, 8)}\` | ${bucketName} | ${w ?? "-"} | ${bandLabel} | - | - | - | - | - | - | - |`);
      continue;
    }

    const d = (a.evalScore ?? 0) - (b.evalScore ?? 0);
    totalDelta += d;
    countDelta++;
    if (d > 0.05) upCount.count++;
    else if (d < -0.05) downCount.count++;
    else sameCount.count++;

    // Aggregate per-bucket.
    if (bucket) {
      const s = bucketStats[bucket.name];
      if (b.evalScore !== null) { s.v1Sum += b.evalScore; s.v1Count++; }
      if (a.evalScore !== null) { s.v2Sum += a.evalScore; s.v2Count++; }
      s.deltaSum += d; s.deltaCount++;
      if (d < s.minDelta) s.minDelta = d;
      if (d > s.maxDelta) s.maxDelta = d;
      if (w !== null) { s.weightSum += w; s.weightCount++; }
      s.bandCounts[bandLabel] = (s.bandCounts[bandLabel] ?? 0) + 1;
    }

    rows.push(
      `| \`${pid.slice(0, 8)}\` | ${bucketName} | ${w !== null ? w.toFixed(2) : "-"} | ${bandLabel} ` +
      `| ${b.evalScore ?? "-"} | ${a.evalScore ?? "-"} | ${d.toFixed(2)} ` +
      `| ${gap(b.visualScore, b.codeScore)} | ${gap(a.visualScore, a.codeScore)} ` +
      `| ${b.evalSource ?? "-"} | ${a.evalSource ?? "-"} |`,
    );
  }

  const meanDelta = totalDelta / countDelta;

  // Per-bucket Δ table.
  const bucketRows: string[] = [];
  bucketRows.push("| Bucket | n | v1 mean | v2 mean | Mean Δ | Range | v2 mean weight |");
  bucketRows.push("|---|---|---|---|---|---|---|");
  for (const b of BUCKETS) {
    const s = bucketStats[b.name];
    const v1m = s.v1Count > 0 ? (s.v1Sum / s.v1Count).toFixed(2) : "-";
    const v2m = s.v2Count > 0 ? (s.v2Sum / s.v2Count).toFixed(2) : "-";
    const dm = s.deltaCount > 0 ? (s.deltaSum / s.deltaCount).toFixed(2) : "-";
    const range = s.deltaCount > 0 ? `[${s.minDelta.toFixed(2)}, ${s.maxDelta >= 0 ? "+" : ""}${s.maxDelta.toFixed(2)}]` : "-";
    const wm = s.weightCount > 0 ? (s.weightSum / s.weightCount).toFixed(3) : "-";
    bucketRows.push(`| ${b.name} | ${s.n} | ${v1m} | ${v2m} | ${dm} | ${range} | ${wm} |`);
  }
  bucketRows.push(`| **Overall** | **${countDelta}** | — | — | **${meanDelta.toFixed(2)}** | — | — |`);

  // Per-bucket weight-band distribution.
  const bandRows: string[] = [];
  bandRows.push("| Bucket | visual/assembly (<0.45) | balanced (0.45–0.70) | sealed/code-heavy (0.70+) |");
  bandRows.push("|---|---|---|---|");
  for (const b of BUCKETS) {
    const s = bucketStats[b.name];
    const va = s.bandCounts["visual/assembly (0.20–0.45)"] ?? 0;
    const ba = s.bandCounts["balanced (0.45–0.70)"] ?? 0;
    const sh = s.bandCounts["sealed/code-heavy (0.70+)"] ?? 0;
    bandRows.push(`| ${b.name} | ${va} | ${ba} | ${sh} |`);
  }

  const outPath = resolve(__dirname, "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-results-v2.md");
  const report = [
    `# Per-Prompt Eval Plan — A/B Test Results (v2: assembly/mechanism band)`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``,
    `- **30 prompts** tested across PCB Cases (8), Primitives (4), Boolean Operations (4), Hinges (4), Generic Enclosures (4), bd_warehouse (3), Extrusions (3).`,
    `- **v1** = single 3-band template (visual / balanced / sealed). State captured fresh just before the v2 regen.`,
    `- **v2** = 4-band template, adds an "assembly/mechanism" band (0.30–0.45) for hinges, gears, kinematic structures.`,
    `- **Mean composite Δ (v1→v2):** ${meanDelta.toFixed(2)}`,
    `- **Distribution:** ${upCount.count} up, ${downCount.count} down, ${sameCount.count} unchanged`,
    ``,
    `## Per-bucket Δ`,
    ``,
    ...bucketRows,
    ``,
    `## Per-bucket weight-band distribution (v2)`,
    ``,
    ...bandRows,
    ``,
    `## Per-prompt results`,
    ``,
    ...rows,
    ``,
  ].join("\n");

  writeFileSync(outPath, report, "utf-8");
  console.log(`Wrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
