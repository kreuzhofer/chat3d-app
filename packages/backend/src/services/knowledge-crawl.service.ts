/**
 * Knowledge Crawl Service
 *
 * Strategy-based crawlers that fetch code from external sources.
 * Each strategy knows how to extract code entries from a specific source type.
 * Called by the job queue worker — never directly from API routes.
 */

import * as cheerio from "cheerio";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { updateCrawlStatus, type GitHubFileConfig, type GitHubTestConfig, type ReadTheDocsConfig, type ReferenceUrlConfig, type SourceStrategy } from "./knowledge-source.service.js";
import { fetchAndConvert, type ConvertFormat } from "./knowledge-convert.service.js";
import { chunkMarkdown, type ChunkStrategy } from "./knowledge-chunk.service.js";

const logger = createLogger("knowledge-crawl");

// ── Types ────────────────────────────────────────────────────────────

interface RawEntry {
  sourceUrl: string;
  sourceType: string;
  title: string;
  description: string;
  code: string;
  concepts: string[];
}

// Strategy → source_type mapping
const STRATEGY_SOURCE_TYPE: Record<SourceStrategy, string> = {
  github_file: "github_example",
  github_test_functions: "github_test",
  readthedocs: "docs",
  manual: "manual",
  reference_upload: "reference",
  reference_url: "reference",
};

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Crawl a single source. Updates the source's crawl status.
 * Designed to be called from a job worker.
 */
export async function crawlSource(sourceId: string): Promise<{ added: number; skipped: number }> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (source.strategy === "manual" || source.strategy === "reference_upload") {
    throw new Error(`Cannot crawl a ${source.strategy} source — add entries manually`);
  }

  await updateCrawlStatus(sourceId, "running");
  logger.info({ sourceId, name: source.name, strategy: source.strategy }, "starting crawl");

  try {
    const config = source.config as Record<string, unknown>;
    let entries: RawEntry[];

    switch (source.strategy) {
      case "github_file":
        entries = await crawlGitHubFiles(config as unknown as GitHubFileConfig);
        break;
      case "github_test_functions":
        entries = await crawlGitHubTestFunctions(config as unknown as GitHubTestConfig);
        break;
      case "readthedocs":
        entries = await crawlReadTheDocs(config as unknown as ReadTheDocsConfig);
        break;
      case "reference_url":
        entries = await crawlReferenceUrl(config as unknown as ReferenceUrlConfig);
        break;
      default:
        throw new Error(`Unknown strategy: ${source.strategy}`);
    }

    const { added, skipped } = await insertEntries(entries, sourceId);

    await updateCrawlStatus(sourceId, "success", `${added} added, ${skipped} skipped`, added, skipped);
    logger.info({ sourceId, added, skipped }, "crawl completed");
    return { added, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCrawlStatus(sourceId, "error", message);
    logger.error({ sourceId, err: message }, "crawl failed");
    throw err;
  }
}

// ── GitHub File Strategy ─────────────────────────────────────────────

/** Per-source token wins, otherwise fall back to central GITHUB_TOKEN env var. */
function resolveGitHubToken(perSourceToken?: string): string | undefined {
  return perSourceToken || config.github.token;
}

async function crawlGitHubFiles(cfg: GitHubFileConfig): Promise<RawEntry[]> {
  const { repo, branch, directory, fileExtension, skipPatterns } = cfg;
  const githubToken = resolveGitHubToken(cfg.githubToken);
  logger.info({ repo, branch, directory }, "crawling GitHub files");

  const files = await fetchGitHubDirectory(repo, branch, directory, githubToken);
  const entries: RawEntry[] = [];

  for (const file of files) {
    if (!file.name.endsWith(fileExtension)) continue;
    if (skipPatterns?.some(p => matchesGlob(file.name, p))) continue;

    try {
      const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
      const code = await fetchFileContent(`${rawBase}/${file.path}`, githubToken);

      // Skip files that don't look like build123d code
      if (!code.includes("build123d") && !code.includes("BuildPart") && !code.includes("BuildSketch")) continue;

      entries.push({
        sourceUrl: `https://github.com/${repo}/blob/${branch}/${file.path}`,
        sourceType: "github_example",
        title: file.name.replace(/\.py$/, "").replace(/_/g, " "),
        description: extractDescriptionFromCode(code, file.name),
        code,
        concepts: extractConceptsFromCode(code),
      });
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), file: file.name }, "failed to fetch file");
    }
  }

  logger.info({ count: entries.length }, "GitHub files crawled");
  return entries;
}

// ── GitHub Test Functions Strategy ───────────────────────────────────

async function crawlGitHubTestFunctions(cfg: GitHubTestConfig): Promise<RawEntry[]> {
  const { repo, branch, directory, functionPrefix, minCodeLength } = cfg;
  const githubToken = resolveGitHubToken(cfg.githubToken);
  logger.info({ repo, branch, directory }, "crawling GitHub test functions");

  const files = await fetchGitHubDirectory(repo, branch, directory, githubToken);
  const entries: RawEntry[] = [];

  // Only include test files that exercise build123d API
  const relevantTests = files.filter(f =>
    f.name.endsWith(".py") && (
      f.name.startsWith("test_build_") ||
      f.name === "test_algebra.py" ||
      f.name === "test_build_generic.py"
    ),
  );

  for (const file of relevantTests) {
    try {
      const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
      const code = await fetchFileContent(`${rawBase}/${file.path}`, githubToken);

      const testFunctions = splitTestFunctions(code, file.name, repo, branch, file.path, functionPrefix, minCodeLength);
      entries.push(...testFunctions);
      logger.debug({ file: file.name, functions: testFunctions.length }, "crawled test file");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), file: file.name }, "failed to fetch test");
    }
  }

  logger.info({ count: entries.length }, "GitHub test functions crawled");
  return entries;
}

function splitTestFunctions(
  code: string,
  filename: string,
  repo: string,
  branch: string,
  filePath: string,
  functionPrefix: string,
  minCodeLength: number,
): RawEntry[] {
  const entries: RawEntry[] = [];
  const prefixEscaped = functionPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const funcRegex = new RegExp(
    `^( {4}def (${prefixEscaped}\\w+)\\(self\\):.*?)(?=\\n {4}def |\\nclass |$)`,
    "gms",
  );
  let match;

  while ((match = funcRegex.exec(code)) !== null) {
    const funcCode = match[1].trim();
    const funcName = match[2];

    if (funcCode.length < minCodeLength) continue;
    // Must contain build123d API calls
    if (!/(?:Box|Cylinder|Sphere|extrude|BuildPart|BuildSketch|fillet|chamfer|loft|sweep|revolve)/.test(funcCode)) continue;

    entries.push({
      sourceUrl: `https://github.com/${repo}/blob/${branch}/${filePath}#${funcName}`,
      sourceType: "github_test",
      title: `${filename}: ${funcName}`,
      description: `Test function demonstrating ${funcName.replace(new RegExp(`^${prefixEscaped}`), "").replace(/_/g, " ")}`,
      code: funcCode,
      concepts: extractConceptsFromCode(funcCode),
    });
  }

  return entries;
}

// ── ReadTheDocs Strategy ─────────────────────────────────────────────

async function crawlReadTheDocs(config: ReadTheDocsConfig): Promise<RawEntry[]> {
  const { baseUrl, pages } = config;
  const normalizedBase = baseUrl.replace(/\/$/, "");
  logger.info({ baseUrl: normalizedBase, pages: pages.length }, "crawling ReadTheDocs");

  const allEntries: RawEntry[] = [];

  for (const page of pages) {
    try {
      const entries = await crawlDocsPage(normalizedBase, page);
      allEntries.push(...entries);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), page }, "failed to crawl docs page");
    }
    // Rate limit: be polite to ReadTheDocs
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info({ total: allEntries.length }, "ReadTheDocs crawl complete");
  return allEntries;
}

async function crawlDocsPage(baseUrl: string, pagePath: string): Promise<RawEntry[]> {
  const url = `${baseUrl}/${pagePath}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    logger.warn({ status: resp.status, url }, "failed to fetch docs page");
    return [];
  }

  const html = await resp.text();
  const $ = cheerio.load(html);
  const entries: RawEntry[] = [];
  let blockIndex = 0;

  // Find Python code blocks — Sphinx generates these in various formats
  const codeBlocks = $(
    'div.highlight-python pre, div.highlight-default pre, div.highlight pre, pre.literal-block',
  );

  codeBlocks.each((_i, el) => {
    const code = $(el).text().trim();

    // Must be substantial code with build123d content
    if (code.length < 80) return;
    if (!/(?:build123d|BuildPart|BuildSketch|BuildLine|Box|Cylinder|extrude|fillet)/.test(code)) return;

    blockIndex++;

    // Find the nearest heading via DOM traversal
    const section = $(el).closest("section, div.section");
    const headingEl = section.length > 0
      ? section.find("h1, h2, h3, h4").first()
      : null;
    const heading = headingEl && headingEl.length > 0
      ? headingEl.text().replace(/¶$/, "").trim()
      : `${pagePath.replace(/\.html$/, "")} example ${blockIndex}`;

    // Get description from surrounding paragraph
    const prevP = $(el).closest("div").prev("p");
    const description = prevP.length > 0 ? prevP.text().trim().slice(0, 500) : "";

    const anchor = heading.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    entries.push({
      sourceUrl: `${url}#${anchor}`,
      sourceType: "docs",
      title: heading.slice(0, 200),
      description,
      code,
      concepts: extractConceptsFromCode(code),
    });
  });

  logger.info({ page: pagePath, entries: entries.length }, "docs page crawled");
  return entries;
}

// ── Reference URL Strategy ───────────────────────────────────────────

async function crawlReferenceUrl(cfg: ReferenceUrlConfig): Promise<RawEntry[]> {
  const { url, format, chunkStrategy, tags } = cfg;
  logger.info({ url, format, chunkStrategy }, "fetching reference URL");

  const result = await fetchAndConvert(url, (format ?? "auto") as ConvertFormat);
  const strategy = (chunkStrategy ?? "none") as ChunkStrategy;
  const chunks = chunkMarkdown(result.markdown, strategy, { documentTitle: result.title });

  logger.info({ chunks: chunks.length, strategy }, "reference URL chunked");

  return chunks.map((chunk) => ({
    sourceUrl: chunks.length === 1 ? url : `${url}#chunk-${chunk.index}`,
    sourceType: "reference",
    title: chunk.title.slice(0, 200),
    description: chunks.length === 1
      ? `Converted from ${result.detectedFormat} format`
      : `${result.title} — section ${chunk.index + 1} of ${chunks.length}`,
    code: chunk.content,
    concepts: tags ?? [],
  }));
}

// ── Database insertion ───────────────────────────────────────────────

async function insertEntries(
  entries: RawEntry[],
  sourceId: string,
): Promise<{ added: number; skipped: number }> {
  // Check which source_urls already exist for this source
  const existingUrls = new Set(
    (await prisma.build123dKnowledge.findMany({
      where: { sourceId },
      select: { sourceUrl: true },
    })).map(r => r.sourceUrl),
  );

  const newEntries = entries.filter(e => !existingUrls.has(e.sourceUrl));
  const skipped = entries.length - newEntries.length;

  if (newEntries.length === 0) {
    logger.info({ skipped }, "all entries already exist");
    return { added: 0, skipped };
  }

  // Batch insert
  const BATCH = 50;
  let added = 0;
  for (let i = 0; i < newEntries.length; i += BATCH) {
    const batch = newEntries.slice(i, i + BATCH);
    await prisma.build123dKnowledge.createMany({
      data: batch.map(e => ({
        sourceUrl: e.sourceUrl,
        sourceType: e.sourceType,
        title: e.title,
        description: e.description || null,
        code: e.code,
        concepts: e.concepts,
        sourceId,
      })),
    });
    added += batch.length;
  }

  logger.info({ added, skipped }, "entries inserted");
  return { added, skipped };
}

// ── Shared Helpers ───────────────────────────────────────────────────

async function fetchGitHubDirectory(
  repo: string,
  branch: string,
  dirPath: string,
  githubToken?: string,
): Promise<{ name: string; path: string; download_url: string }[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const results: { name: string; path: string; download_url: string }[] = [];

  async function fetchDir(dir: string): Promise<void> {
    const url = `https://api.github.com/repos/${repo}/contents/${dir}?ref=${branch}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${url}`);
    const items = (await resp.json()) as Array<{ name: string; path: string; download_url: string; type: string }>;

    for (const item of items) {
      if (item.type === "file") {
        results.push({ name: item.name, path: item.path, download_url: item.download_url });
      } else if (item.type === "dir") {
        await fetchDir(item.path);
      }
    }
  }

  await fetchDir(dirPath);
  return results;
}

async function fetchFileContent(url: string, githubToken?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`Fetch failed ${resp.status}: ${url}`);
  return resp.text();
}

export function extractConceptsFromCode(code: string): string[] {
  const concepts = new Set<string>();
  const patterns: [RegExp, string][] = [
    [/\bBox\b/, "box"],
    [/\bCylinder\b/, "cylinder"],
    [/\bSphere\b/, "sphere"],
    [/\bCone\b/, "cone"],
    [/\bTorus\b/, "torus"],
    [/\bWedge\b/, "wedge"],
    [/\bextrude\b/, "extrude"],
    [/\brevolve\b/, "revolve"],
    [/\bsweep\b/, "sweep"],
    [/\bloft\b/, "loft"],
    [/\bfillet\b/, "fillet"],
    [/\bchamfer\b/, "chamfer"],
    [/\boffset\b/, "offset"],
    [/\bshell\b/, "shell"],
    [/\bBuildPart\b/, "BuildPart"],
    [/\bBuildSketch\b/, "BuildSketch"],
    [/\bBuildLine\b/, "BuildLine"],
    [/\bLocations\b/, "locations"],
    [/\bGridLocations\b/, "grid_pattern"],
    [/\bPolarLocations\b/, "polar_pattern"],
    [/\bHexLocations\b/, "hex_pattern"],
    [/\bMode\.SUBTRACT\b/, "boolean_subtract"],
    [/\bMode\.INTERSECT\b/, "boolean_intersect"],
    [/\bMode\.ADD\b/, "boolean_add"],
    [/\bCircle\b/, "circle"],
    [/\bRectangle\b/, "rectangle"],
    [/\bPolygon\b/, "polygon"],
    [/\bLine\b/, "line"],
    [/\bArc\b/, "arc"],
    [/\bSpline\b/, "spline"],
    [/\bText\b/, "text"],
    [/\bHelix\b/, "helix"],
    [/\bJoint\b|joint/, "joint"],
    [/\bmake_face\b/, "make_face"],
    [/\bthicken\b/, "thicken"],
    [/\bsplit\b/, "split"],
    [/\bmirror\b/, "mirror"],
    [/\bsketch_on_face\b|Plane\(/, "sketch_on_face"],
    [/\bColor\b/, "color"],
    [/\bimport_step\b|import_stl\b/, "import"],
    [/\bexport_step\b|export_stl\b|export_3mf\b/, "export"],
  ];

  for (const [re, concept] of patterns) {
    if (re.test(code)) concepts.add(concept);
  }
  return Array.from(concepts);
}

function extractDescriptionFromCode(code: string, filename: string): string {
  // Try docstring
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

  return filename.replace(/\.py$/, "").replace(/_/g, " ");
}

/** Simple glob matching for skip patterns (supports * wildcard only). */
function matchesGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return regex.test(name);
}
