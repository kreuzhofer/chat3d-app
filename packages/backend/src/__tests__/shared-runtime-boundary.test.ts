/**
 * `@chat3d/shared` is a TYPE-ONLY dependency of the deployed packages.
 *
 * Neither container image ships the package: the backend Dockerfile builds from
 * `packages/backend` alone, the frontend from `packages/frontend`. Type imports
 * are erased before the code ever runs, so the omission is invisible — until a
 * value import is added, and then the container dies on boot with
 * ERR_MODULE_NOT_FOUND. That is exactly how 14c3825 shipped a backend image
 * that could not start.
 *
 * These tests hold the boundary from both sides: no value imports may appear in
 * deployed source, and the backend's local copy of the thinking-effort list may
 * not drift from the shared union it mirrors.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { THINKING_EFFORTS as SHARED_EFFORTS } from "@chat3d/shared";
import { THINKING_EFFORTS, isThinkingEffort } from "../utils/thinking-effort.js";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const DEPLOYED_SOURCE_DIRS = [
  join(repoRoot, "packages", "backend", "src"),
  join(repoRoot, "packages", "frontend", "src"),
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

/**
 * Tests are exempt: vitest never runs inside a container, so a value import
 * there cannot break a deployment — and this file needs one to compare the two
 * lists at all.
 */
function isTestFile(path: string): boolean {
  return path.includes("__tests__") || /\.test\.tsx?$/.test(path);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(abs));
    } else if (SOURCE_EXTENSIONS.some((ext) => abs.endsWith(ext)) && !isTestFile(abs)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Every import statement that pulls from @chat3d/shared, with the text between
 * `import` and `from` captured so the caller can tell a type-only statement
 * from one that survives to runtime.
 *
 * The clause may not contain `from`, `import` or `;` — without that guard the
 * lazy quantifier happily starts at some unrelated earlier import and runs all
 * the way down to the @chat3d/shared one, reporting whichever statement came
 * first in the file.
 */
const SHARED_IMPORT =
  /import\s+((?:(?!\bfrom\b|\bimport\b|;)[\s\S])*?)\s*from\s*["']@chat3d\/shared["']/g;

export function findValueImportsOfShared(source: string): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(SHARED_IMPORT)) {
    const clause = match[1];
    // `import type { ... }` is erased wholesale. So is a clause whose every
    // named specifier carries an inline `type` marker.
    if (/^type\b/.test(clause)) continue;
    offenders.push(match[0].split("\n")[0].trim());
  }
  // A bare side-effect import survives to runtime with no specifiers at all.
  if (/import\s*["']@chat3d\/shared["']/.test(source)) offenders.push('import "@chat3d/shared"');
  return offenders;
}

describe("@chat3d/shared runtime boundary", () => {
  it("has no value imports of @chat3d/shared in deployed source", () => {
    const offenders: string[] = [];
    for (const dir of DEPLOYED_SOURCE_DIRS) {
      for (const file of walk(dir)) {
        for (const stmt of findValueImportsOfShared(readFileSync(file, "utf8"))) {
          offenders.push(`${relative(repoRoot, file)}: ${stmt}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognises a value import but not a type-only one", () => {
    expect(findValueImportsOfShared('import type { A } from "@chat3d/shared";')).toEqual([]);
    expect(findValueImportsOfShared('import type {\n  A,\n} from "@chat3d/shared";')).toEqual([]);
    expect(findValueImportsOfShared('import { A } from "@chat3d/shared";')).toHaveLength(1);
    expect(findValueImportsOfShared('import "@chat3d/shared";')).toHaveLength(1);
  });
});

describe("thinking-effort runtime list", () => {
  it("matches the shared union exactly, in order", () => {
    expect([...THINKING_EFFORTS]).toEqual([...SHARED_EFFORTS]);
  });

  it("accepts every shared effort and rejects anything else", () => {
    for (const effort of SHARED_EFFORTS) expect(isThinkingEffort(effort)).toBe(true);
    for (const notAnEffort of ["", "OFF", "none", "highest", 1, null, undefined, {}]) {
      expect(isThinkingEffort(notAnEffort)).toBe(false);
    }
  });
});
