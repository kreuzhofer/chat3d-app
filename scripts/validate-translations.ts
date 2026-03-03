/**
 * Translation Validation Script
 *
 * Validates that all translation JSON files across frontend and backend:
 * 1. Are valid JSON
 * 2. Have matching keys between all languages (en, de)
 * 3. Have consistent nested structure
 *
 * Usage: npx tsx scripts/validate-translations.ts
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

const TRANSLATION_DIRS = [
  {
    label: "Frontend",
    base: join(ROOT, "packages/frontend/public/locales"),
  },
  {
    label: "Backend",
    base: join(ROOT, "packages/backend/src/locales"),
  },
];

const REFERENCE_LANG = "en";

interface ValidationError {
  file: string;
  message: string;
}

const errors: ValidationError[] = [];

function getNestedKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...getNestedKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

function loadJson(filePath: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch (e) {
    errors.push({
      file: relative(ROOT, filePath),
      message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
}

for (const { label, base } of TRANSLATION_DIRS) {
  if (!existsSync(base)) {
    errors.push({ file: base, message: `${label} locales directory not found` });
    continue;
  }

  const languages = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (!languages.includes(REFERENCE_LANG)) {
    errors.push({
      file: relative(ROOT, base),
      message: `Reference language '${REFERENCE_LANG}' not found. Found: ${languages.join(", ")}`,
    });
    continue;
  }

  // Collect namespaces from reference language
  const refDir = join(base, REFERENCE_LANG);
  const namespaces = readdirSync(refDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();

  // Check each non-reference language
  for (const lang of languages) {
    if (lang === REFERENCE_LANG) continue;

    const langDir = join(base, lang);

    // Check all namespaces exist
    for (const ns of namespaces) {
      const refFile = join(refDir, `${ns}.json`);
      const langFile = join(langDir, `${ns}.json`);

      if (!existsSync(langFile)) {
        errors.push({
          file: relative(ROOT, langFile),
          message: `Missing namespace file. Expected to match ${REFERENCE_LANG}/${ns}.json`,
        });
        continue;
      }

      const refData = loadJson(refFile);
      const langData = loadJson(langFile);

      if (!refData || !langData) continue;

      const refKeys = getNestedKeys(refData);
      const langKeys = getNestedKeys(langData);

      // Keys in reference but missing in this language
      const missing = refKeys.filter((k) => !langKeys.includes(k));
      for (const key of missing) {
        errors.push({
          file: relative(ROOT, langFile),
          message: `Missing key: "${key}" (exists in ${REFERENCE_LANG}/${ns}.json)`,
        });
      }

      // Extra keys in this language not in reference
      const extra = langKeys.filter((k) => !refKeys.includes(k));
      for (const key of extra) {
        errors.push({
          file: relative(ROOT, langFile),
          message: `Extra key: "${key}" (not in ${REFERENCE_LANG}/${ns}.json)`,
        });
      }
    }

    // Check for extra namespace files in this language
    const langNamespaces = readdirSync(langDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));

    const extraNamespaces = langNamespaces.filter((ns) => !namespaces.includes(ns));
    for (const ns of extraNamespaces) {
      errors.push({
        file: relative(ROOT, join(langDir, `${ns}.json`)),
        message: `Extra namespace file not present in ${REFERENCE_LANG}/`,
      });
    }
  }
}

// Report results
if (errors.length === 0) {
  console.log("All translation files are valid and consistent.");
  process.exit(0);
} else {
  console.error(`Found ${errors.length} translation error(s):\n`);
  for (const err of errors) {
    console.error(`  ${err.file}: ${err.message}`);
  }
  process.exit(1);
}
