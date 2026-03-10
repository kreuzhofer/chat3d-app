/**
 * Crawl Build123d knowledge sources and populate the build123d_knowledge table.
 *
 * Sources:
 *   1. GitHub repo examples/ — complete working scripts
 *   2. GitHub repo tests/ — test functions with API usage patterns
 *   3. ReadTheDocs pages — code blocks extracted from documentation
 *
 * Usage:
 *   npx tsx src/scripts/crawl-build123d-knowledge.ts [--source github|docs|all] [--dry-run]
 *
 * Idempotent: uses source_url as dedup key (skips existing entries).
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("crawl-knowledge");

// ── Configuration ────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";
const REPO = "gumyr/build123d";
const BRANCH = "dev"; // dev branch has latest

const DOCS_BASE = "https://build123d.readthedocs.io/en/latest";
const DOCS_PAGES = [
  "introductory_examples.html",
  "tutorial_design.html",
  "tutorial_selectors.html",
  "tutorial_lego.html",
  "tutorial_joints.html",
  "tutorial_surface_modeling.html",
  "key_concepts_builder.html",
  "key_concepts_algebra.html",
  "examples_1.html",
];

const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// ── Types ────────────────────────────────────────────────────────────

interface RawEntry {
  sourceUrl: string;
  sourceType: "docs" | "github_example" | "github_test";
  title: string;
  description: string;
  code: string;
}

// ── GitHub crawl ─────────────────────────────────────────────────────

async function fetchGitHubDirectory(dirPath: string): Promise<{ name: string; download_url: string }[]> {
  const url = `${GITHUB_API}/repos/${REPO}/contents/${dirPath}?ref=${BRANCH}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${url}`);
  const items = await resp.json() as Array<{ name: string; download_url: string; type: string }>;
  return items.filter(i => i.type === "file" && i.name.endsWith(".py"));
}

async function fetchFileContent(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed ${resp.status}: ${url}`);
  return resp.text();
}

function extractDescriptionFromCode(code: string, filename: string): string {
  // Try to get docstring or leading comment
  const docstringMatch = code.match(/^(?:#[^\n]*\n)*\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
  if (docstringMatch) {
    return (docstringMatch[1] ?? docstringMatch[2] ?? "").trim().slice(0, 500);
  }

  // Try leading comments
  const lines = code.split("\n");
  const commentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") && !trimmed.startsWith("#!")) {
      commentLines.push(trimmed.replace(/^#+\s*/, ""));
    } else if (trimmed === "") {
      continue;
    } else {
      break;
    }
  }
  if (commentLines.length > 0) return commentLines.join(" ").slice(0, 500);

  // Fallback to filename
  return filename.replace(/\.py$/, "").replace(/_/g, " ");
}

async function crawlGitHubExamples(): Promise<RawEntry[]> {
  logger.info("crawling GitHub examples/");
  const files = await fetchGitHubDirectory("examples");
  const entries: RawEntry[] = [];

  for (const file of files) {
    // Skip algebra variants — they duplicate the builder-mode examples
    if (file.name.includes("_algebra")) continue;

    try {
      const code = await fetchFileContent(`${GITHUB_RAW_BASE}/examples/${file.name}`);
      // Skip files that don't look like build123d code
      if (!code.includes("build123d") && !code.includes("BuildPart") && !code.includes("BuildSketch")) continue;

      entries.push({
        sourceUrl: `https://github.com/${REPO}/blob/${BRANCH}/examples/${file.name}`,
        sourceType: "github_example",
        title: file.name.replace(/\.py$/, "").replace(/_/g, " "),
        description: extractDescriptionFromCode(code, file.name),
        code,

      });
      logger.debug({ file: file.name }, "crawled example");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), file: file.name }, "failed to fetch example");
    }
  }

  logger.info({ count: entries.length }, "GitHub examples crawled");
  return entries;
}

async function crawlGitHubTests(): Promise<RawEntry[]> {
  logger.info("crawling GitHub tests/");
  const files = await fetchGitHubDirectory("tests");
  const entries: RawEntry[] = [];

  // Only include test files that exercise build123d API (not infrastructure tests)
  const relevantTests = files.filter(f =>
    f.name.startsWith("test_build_") ||
    f.name === "test_algebra.py" ||
    f.name === "test_build_generic.py",
  );

  for (const file of relevantTests) {
    try {
      const code = await fetchFileContent(`${GITHUB_RAW_BASE}/tests/${file.name}`);

      // Split into individual test functions for more granular entries
      const testFunctions = splitTestFunctions(code, file.name);
      for (const tf of testFunctions) {
        entries.push(tf);
      }
      logger.debug({ file: file.name, functions: testFunctions.length }, "crawled test file");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), file: file.name }, "failed to fetch test");
    }
  }

  logger.info({ count: entries.length }, "GitHub tests crawled");
  return entries;
}

function splitTestFunctions(code: string, filename: string): RawEntry[] {
  const entries: RawEntry[] = [];
  // Match test methods: def test_xxx(self):
  const funcRegex = /^( {4}def (test_\w+)\(self\):.*?)(?=\n {4}def |\nclass |\Z)/gms;
  let match;

  while ((match = funcRegex.exec(code)) !== null) {
    const funcCode = match[1].trim();
    const funcName = match[2];

    // Skip very short tests (just assert statements with no real API usage)
    if (funcCode.length < 100) continue;
    // Must contain build123d API calls
    if (!/(?:Box|Cylinder|Sphere|extrude|BuildPart|BuildSketch|fillet|chamfer|loft|sweep|revolve)/.test(funcCode)) continue;

    entries.push({
      sourceUrl: `https://github.com/${REPO}/blob/${BRANCH}/tests/${filename}#${funcName}`,
      sourceType: "github_test",
      title: `${filename}: ${funcName}`,
      description: `Test function demonstrating ${funcName.replace(/^test_/, "").replace(/_/g, " ")}`,
      code: funcCode,

    });
  }

  return entries;
}

// ── Docs crawl ───────────────────────────────────────────────────────

async function crawlDocsPage(pagePath: string): Promise<RawEntry[]> {
  const url = `${DOCS_BASE}/${pagePath}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    logger.warn({ status: resp.status, url }, "failed to fetch docs page");
    return [];
  }

  const html = await resp.text();
  const entries: RawEntry[] = [];

  // Extract Python code blocks from HTML
  // readthedocs uses <div class="highlight-python"> or <pre> blocks
  const codeBlockRegex = /<(?:div class="highlight-python[^"]*"|pre)[^>]*>\s*<(?:pre|code)[^>]*>([\s\S]*?)<\/(?:pre|code)>/gi;
  let blockMatch;
  let blockIndex = 0;

  while ((blockMatch = codeBlockRegex.exec(html)) !== null) {
    let code = blockMatch[1]
      .replace(/<[^>]+>/g, "") // Strip remaining HTML tags
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();

    // Must be substantial code with build123d content
    if (code.length < 80) continue;
    if (!/(?:build123d|BuildPart|BuildSketch|BuildLine|Box|Cylinder|extrude|fillet)/.test(code)) continue;

    blockIndex++;

    // Try to find a heading before this code block
    const beforeBlock = html.slice(Math.max(0, blockMatch.index - 2000), blockMatch.index);
    const headingMatch = beforeBlock.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>\s*$/i);
    const heading = headingMatch
      ? headingMatch[1].replace(/<[^>]+>/g, "").trim()
      : `${pagePath.replace(/\.html$/, "")} example ${blockIndex}`;

    // Get paragraph text after heading for description
    const descMatch = beforeBlock.match(/<p>([\s\S]*?)<\/p>\s*$/i);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 500)
      : "";

    entries.push({
      sourceUrl: `${url}#${heading.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`,
      sourceType: "docs",
      title: heading.slice(0, 200),
      description,
      code,
    });
  }

  logger.info({ page: pagePath, entries: entries.length }, "docs page crawled");
  return entries;
}

async function crawlDocs(): Promise<RawEntry[]> {
  logger.info("crawling readthedocs pages");
  const allEntries: RawEntry[] = [];

  for (const page of DOCS_PAGES) {
    const entries = await crawlDocsPage(page);
    allEntries.push(...entries);
    // Rate limit: be nice to readthedocs
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info({ total: allEntries.length }, "docs crawl complete");
  return allEntries;
}

// ── Database insertion ───────────────────────────────────────────────

async function insertEntries(entries: RawEntry[], dryRun: boolean): Promise<{ inserted: number; skipped: number }> {
  if (dryRun) {
    logger.info({ count: entries.length }, "DRY RUN — would insert entries");
    for (const e of entries.slice(0, 5)) {
      logger.info({ title: e.title, sourceType: e.sourceType, codeLength: e.code.length }, "sample entry");
    }
    return { inserted: 0, skipped: entries.length };
  }

  // Check which source_urls already exist
  const existingUrls = new Set(
    (await prisma.build123dKnowledge.findMany({
      select: { sourceUrl: true },
    })).map(r => r.sourceUrl),
  );

  const newEntries = entries.filter(e => !existingUrls.has(e.sourceUrl));
  const skipped = entries.length - newEntries.length;

  if (newEntries.length === 0) {
    logger.info({ skipped }, "all entries already exist");
    return { inserted: 0, skipped };
  }

  // Batch insert
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < newEntries.length; i += BATCH) {
    const batch = newEntries.slice(i, i + BATCH);
    await prisma.build123dKnowledge.createMany({
      data: batch.map(e => ({
        sourceUrl: e.sourceUrl,
        sourceType: e.sourceType,
        title: e.title,
        description: e.description || null,
        code: e.code,
      })),
    });
    inserted += batch.length;
  }

  logger.info({ inserted, skipped }, "entries inserted");
  return { inserted, skipped };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const source = args.find(a => a.startsWith("--source="))?.split("=")[1] ?? "all";
  const dryRun = args.includes("--dry-run");

  logger.info({ source, dryRun }, "starting knowledge crawl");

  const allEntries: RawEntry[] = [];

  if (source === "github" || source === "all") {
    const examples = await crawlGitHubExamples();
    const tests = await crawlGitHubTests();
    allEntries.push(...examples, ...tests);
  }

  if (source === "docs" || source === "all") {
    const docs = await crawlDocs();
    allEntries.push(...docs);
  }

  logger.info({
    total: allEntries.length,
    byType: {
      github_example: allEntries.filter(e => e.sourceType === "github_example").length,
      github_test: allEntries.filter(e => e.sourceType === "github_test").length,
      docs: allEntries.filter(e => e.sourceType === "docs").length,
    },
  }, "crawl complete");

  const { inserted, skipped } = await insertEntries(allEntries, dryRun);

  logger.info({ inserted, skipped, total: allEntries.length }, "knowledge crawl finished");

  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "crawl failed");
  process.exit(1);
});
