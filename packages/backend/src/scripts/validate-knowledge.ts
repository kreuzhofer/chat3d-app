/**
 * Validate Build123d knowledge entries against the Build123d container.
 *
 * Runs pending entries through POST /validate/ to confirm they parse and use valid APIs.
 * Marks entries as valid/invalid/error.
 *
 * Usage:
 *   npx tsx src/scripts/validate-knowledge.ts [--limit 100] [--revalidate]
 */

import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("validate-knowledge");

const BUILD123D_URL = config.query.build123dUrl;

interface ValidateResponse {
  valid: boolean;
  errors: string[];
  warnings: Array<{ rule: string; message: string; line: number; severity: string }>;
}

async function validateCode(code: string): Promise<ValidateResponse> {
  const resp = await fetch(`${BUILD123D_URL}/validate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, skip_root_part: true }),
  });

  if (!resp.ok) {
    throw new Error(`Build123d /validate/ returned ${resp.status}`);
  }

  return resp.json() as Promise<ValidateResponse>;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "200", 10);
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

  for (const entry of entries) {
    try {
      // For test functions, we need to wrap them — they're methods, not standalone scripts
      let codeToValidate = entry.code;

      // Test functions start with "def test_" and contain self references
      if (entry.sourceType === "github_test" && codeToValidate.includes("def test_")) {
        // Extract just the body, strip self references, add imports
        codeToValidate = wrapTestCode(codeToValidate);
      }

      // Strip imports and show/display calls that the template provides or that are
      // specific to the OCP VSCode viewer — not relevant for knowledge validation
      codeToValidate = codeToValidate
        .replace(/^from build123d import \*\s*$/gm, "")
        .replace(/^import build123d\s*$/gm, "")
        .replace(/^from build123d import .+$/gm, "")
        .replace(/^from ocp_vscode import .+$/gm, "")
        .replace(/^import ocp_vscode.*$/gm, "")
        .replace(/^show_object\(.*\)\s*$/gm, "")
        .replace(/^show\(.*\)\s*$/gm, "")
        .replace(/^# \[End\]\s*$/gm, "")
        .trim();

      const result = await validateCode(codeToValidate);

      // For knowledge entries, only count syntax/parse errors, not lint warnings.
      // The code may have show() calls, missing root_part, etc. which are fine
      // for reference code — lint rules are about template compliance, not validity.
      const isValid = result.valid;

      await prisma.build123dKnowledge.update({
        where: { id: entry.id },
        data: {
          validationStatus: isValid ? "valid" : "invalid",
          validatedAt: new Date(),
        },
      });

      if (isValid) {
        valid++;
      } else {
        invalid++;
        logger.debug({
          title: entry.title,
          errors: result.errors.slice(0, 2),
        }, "invalid entry");
      }
    } catch (err) {
      errored++;
      await prisma.build123dKnowledge.update({
        where: { id: entry.id },
        data: {
          validationStatus: "error",
          validatedAt: new Date(),
        },
      });
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: errMsg, title: entry.title }, "validation error: " + errMsg);
    }
  }

  logger.info({ valid, invalid, errored, total: entries.length }, "validation complete");
  await prisma.$disconnect();
}

/**
 * Wrap a test function body to make it a standalone script.
 * Strips `self.` references and adds a `root_part` assignment if missing.
 */
function wrapTestCode(code: string): string {
  // Remove the def line and self parameter, auto-detect indent level
  const lines = code.split("\n");
  const bodyLines: string[] = [];
  let inBody = false;
  let indentSize = 0;

  for (const line of lines) {
    if (!inBody) {
      if (line.trim().startsWith("def test_")) {
        inBody = true;
        continue;
      }
    } else {
      // Detect indent level from first non-empty body line
      if (indentSize === 0 && line.trim().length > 0) {
        const match = line.match(/^(\s+)/);
        indentSize = match ? match[1].length : 0;
      }
      // Dedent by detected indent level
      if (indentSize > 0 && line.startsWith(" ".repeat(indentSize))) {
        bodyLines.push(line.slice(indentSize));
      } else if (line.trim() === "") {
        bodyLines.push("");
      } else {
        bodyLines.push(line);
      }
    }
  }

  let body = bodyLines.join("\n")
    .replace(/self\.\w+/g, "result") // Replace self.xxx with result
    .replace(/self,\s*/g, "") // Remove self from function calls
    .trim();

  // If no root_part assignment, add a dummy one for validation
  if (!body.includes("root_part")) {
    body += "\n\n# Added for validation\nroot_part = result if 'result' in dir() else Box(1, 1, 1)\n";
  }

  return body;
}

main().catch((err) => {
  logger.error({ err }, "validation script failed");
  process.exit(1);
});
