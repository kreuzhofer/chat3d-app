/**
 * Validate Build123d knowledge entries.
 *
 * Checks two things:
 *   1. Does the code contain Build123d API usage? (string matching)
 *   2. Is it valid Python syntax? (AST parse via Build123d container)
 *
 * We do NOT check template compliance (root_part, lint rules, forbidden imports).
 * This is reference code from external sources — it just needs to be real,
 * parseable Build123d code that the agent can learn patterns from.
 *
 * Usage:
 *   npx tsx src/scripts/validate-knowledge.ts [--limit=100] [--revalidate]
 */

import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("validate-knowledge");

const BUILD123D_URL = config.query.build123dUrl;

// Build123d API markers — if the code contains any of these, it's build123d code
const BUILD123D_MARKERS = [
  "BuildPart", "BuildSketch", "BuildLine",
  "Box", "Cylinder", "Sphere", "Cone", "Torus", "Wedge",
  "extrude", "revolve", "sweep", "loft", "fillet", "chamfer",
  "offset", "Circle", "Rectangle", "Polygon", "Ellipse",
  "Locations", "GridLocations", "PolarLocations",
  "Mode.ADD", "Mode.SUBTRACT", "Mode.INTERSECT",
  "build123d",
];

function isBuild123dCode(code: string): boolean {
  return BUILD123D_MARKERS.some(marker => code.includes(marker));
}

/**
 * Check if code is valid Python syntax by sending it to the Build123d container.
 * We use skip_root_part and skip_lint to only check syntax.
 */
async function isValidPython(code: string): Promise<{ valid: boolean; error?: string }> {
  const resp = await fetch(`${BUILD123D_URL}/validate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, skip_root_part: true, skip_lint: true }),
  });

  if (!resp.ok) {
    throw new Error(`Build123d /validate/ returned ${resp.status}`);
  }

  const result = await resp.json() as { valid: boolean; errors: string[] };

  // Only syntax errors matter — everything else is fine for reference code
  const syntaxError = result.errors.find(e => e.startsWith("Syntax error:"));
  if (syntaxError) {
    return { valid: false, error: syntaxError };
  }

  return { valid: true };
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "500", 10);
  const revalidate = args.includes("--revalidate");

  const where: Record<string, unknown> = revalidate
    ? {} // Re-validate everything
    : { validationStatus: "pending" };

  const entries = await prisma.build123dKnowledge.findMany({
    where,
    select: { id: true, title: true, code: true, sourceType: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  logger.info({ count: entries.length, revalidate }, "starting validation");

  let valid = 0;
  let invalid = 0;
  let errored = 0;
  let notBuild123d = 0;

  for (const entry of entries) {
    try {
      // Check 1: Is this actually Build123d code?
      if (!isBuild123dCode(entry.code)) {
        notBuild123d++;
        await prisma.build123dKnowledge.update({
          where: { id: entry.id },
          data: { validationStatus: "invalid", validatedAt: new Date() },
        });
        logger.debug({ title: entry.title }, "not build123d code");
        continue;
      }

      // Check 2: Is it valid Python syntax?
      const result = await isValidPython(entry.code);

      await prisma.build123dKnowledge.update({
        where: { id: entry.id },
        data: {
          validationStatus: result.valid ? "valid" : "invalid",
          validatedAt: new Date(),
        },
      });

      if (result.valid) {
        valid++;
      } else {
        invalid++;
        logger.debug({ title: entry.title, error: result.error }, "syntax error");
      }
    } catch (err) {
      errored++;
      await prisma.build123dKnowledge.update({
        where: { id: entry.id },
        data: { validationStatus: "error", validatedAt: new Date() },
      });
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: errMsg, title: entry.title }, "validation error: " + errMsg);
    }
  }

  logger.info({ valid, invalid, notBuild123d, errored, total: entries.length }, "validation complete");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "validation script failed");
  process.exit(1);
});
