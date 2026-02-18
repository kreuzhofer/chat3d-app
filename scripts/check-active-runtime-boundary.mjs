import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const targets = [join(root, "packages", "backend", "src"), join(root, "packages", "frontend", "src")];
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const forbiddenPatterns = [
  { label: "Amplify runtime", regex: /\baws-amplify\b|\@aws-amplify\//i },
  { label: "Mixpanel runtime", regex: /\bmixpanel\b/i },
  { label: "Patreon runtime", regex: /\bpatreon\b/i },
  { label: "OpenSCAD runtime", regex: /\bopenscad\b/i },
];

function shouldInspect(path) {
  for (const ext of allowedExtensions) {
    if (path.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function walkFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }

    if (shouldInspect(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

const findings = [];

for (const target of targets) {
  const files = walkFiles(target);
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    lines.forEach((line, index) => {
      for (const pattern of forbiddenPatterns) {
        if (pattern.regex.test(line)) {
          findings.push({
            file: relative(root, file),
            line: index + 1,
            rule: pattern.label,
            text: line.trim(),
          });
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error("[active-runtime-boundary] forbidden references detected:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
  }
  process.exit(1);
}

console.log("[active-runtime-boundary] OK: no forbidden legacy runtime references in active packages.");
