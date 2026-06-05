/**
 * Reads /tmp/eval-plan-baseline.tsv and /tmp/eval-plan-after.tsv, joins on
 * prompt_id, and writes a markdown report.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

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

const before = parseTsv("/tmp/eval-plan-baseline.tsv");
const after = parseTsv("/tmp/eval-plan-after.tsv");

const rows: string[] = [];
rows.push("| Prompt (first 8) | Before composite | After composite | Δ | Before |v-c| | After |v-c| | Before src | After src | Weight src |");
rows.push("|---|---|---|---|---|---|---|---|---|");

let totalDelta = 0;
let countDelta = 0;
const upCount = { count: 0 };
const downCount = { count: 0 };
const sameCount = { count: 0 };
const weightSourceCount: Record<string, number> = {};

for (const [pid, b] of before) {
  const a = after.get(pid);
  if (!a) continue;
  const d = (a.evalScore ?? 0) - (b.evalScore ?? 0);
  totalDelta += d;
  countDelta++;
  if (d > 0.05) upCount.count++;
  else if (d < -0.05) downCount.count++;
  else sameCount.count++;

  if (a.weightSource) weightSourceCount[a.weightSource] = (weightSourceCount[a.weightSource] ?? 0) + 1;

  rows.push(
    `| \`${pid.slice(0, 8)}\` | ${b.evalScore ?? "-"} | ${a.evalScore ?? "-"} | ${d.toFixed(2)} ` +
    `| ${gap(b.visualScore, b.codeScore)} | ${gap(a.visualScore, a.codeScore)} ` +
    `| ${b.evalSource ?? "-"} | ${a.evalSource ?? "-"} | ${a.weightSource ?? "-"} |`
  );
}

const meanDelta = totalDelta / countDelta;

const outPath = resolve(__dirname, "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-results.md");
const report = [
  `# Per-Prompt Eval Plan — A/B Test Results`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `## Summary`,
  ``,
  `- **30 prompts** tested across PCB Cases (8), Primitives (4), Boolean Operations (4), Hinges (4), Generic Enclosures (4), bd_warehouse (3), Extrusions (3).`,
  `- **Mean composite Δ:** ${meanDelta.toFixed(2)}`,
  `- **Distribution:** ${upCount.count} up, ${downCount.count} down, ${sameCount.count} unchanged`,
  `- **Weight source distribution (after):** ${Object.entries(weightSourceCount).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
  ``,
  `## Per-prompt results`,
  ``,
  ...rows,
  ``,
].join("\n");

writeFileSync(outPath, report, "utf-8");
console.log(`Wrote ${outPath}`);
