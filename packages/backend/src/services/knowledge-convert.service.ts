/**
 * Knowledge Format Conversion Service
 *
 * Converts various input formats to Markdown for reference knowledge entries.
 * Used by the reference_url crawl strategy and reference_upload admin workflow.
 */

import * as cheerio from "cheerio";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("knowledge-convert");

// ── Types ────────────────────────────────────────────────────────────

export type ConvertFormat = "md" | "html" | "csv" | "auto";

export interface ConvertResult {
  markdown: string;
  title: string;
  detectedFormat: ConvertFormat;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Convert content to Markdown based on format.
 * If format is "auto", tries to detect from content or URL extension.
 */
export function convertToMarkdown(
  content: string,
  format: ConvertFormat = "auto",
  sourceUrl?: string,
): ConvertResult {
  const detected = format === "auto" ? detectFormat(content, sourceUrl) : format;

  switch (detected) {
    case "md":
      return { markdown: content, title: extractMarkdownTitle(content), detectedFormat: "md" };
    case "html":
      return convertHtmlToMarkdown(content);
    case "csv":
      return convertCsvToMarkdown(content);
    default:
      return { markdown: content, title: "Untitled", detectedFormat: "md" };
  }
}

/**
 * Fetch a URL and convert its content to Markdown.
 */
export async function fetchAndConvert(
  url: string,
  format: ConvertFormat = "auto",
): Promise<ConvertResult> {
  logger.info({ url, format }, "fetching URL for conversion");

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  const content = await resp.text();

  // Override auto-detection with content-type hint
  let effectiveFormat = format;
  if (format === "auto") {
    if (contentType.includes("text/csv")) effectiveFormat = "csv";
    else if (contentType.includes("text/html")) effectiveFormat = "html";
    else if (contentType.includes("text/markdown")) effectiveFormat = "md";
  }

  return convertToMarkdown(content, effectiveFormat, url);
}

// ── Format Detection ─────────────────────────────────────────────────

function detectFormat(content: string, sourceUrl?: string): ConvertFormat {
  // Check URL extension first
  if (sourceUrl) {
    const urlLower = sourceUrl.toLowerCase();
    if (urlLower.endsWith(".md") || urlLower.endsWith(".markdown")) return "md";
    if (urlLower.endsWith(".csv")) return "csv";
    if (urlLower.endsWith(".html") || urlLower.endsWith(".htm")) return "html";
  }

  // Content-based detection
  const trimmed = content.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) return "html";
  if (/<[a-zA-Z][^>]*>/.test(trimmed.slice(0, 500)) && /<\/[a-zA-Z]+>/.test(trimmed.slice(0, 1000))) return "html";

  // CSV: multiple lines with consistent comma/tab delimiters
  const lines = trimmed.split("\n").slice(0, 5);
  if (lines.length >= 2) {
    const commas = lines.map(l => (l.match(/,/g) ?? []).length);
    if (commas[0] >= 2 && commas.every(c => c === commas[0])) return "csv";
  }

  // Default to Markdown
  return "md";
}

// ── HTML → Markdown ──────────────────────────────────────────────────

function convertHtmlToMarkdown(html: string): ConvertResult {
  const $ = cheerio.load(html);

  // Remove nav, header, footer, scripts, styles
  $("nav, header, footer, script, style, .sidebar, .nav, .menu, .breadcrumb, .pagination").remove();

  // Find main content area
  const mainEl = $("main, article, .content, .main-content, [role='main'], .document, .body").first();
  const root = mainEl.length > 0 ? mainEl : $("body");

  const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled";

  const parts: string[] = [];
  convertElement($, root, parts);

  const markdown = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { markdown, title, detectedFormat: "html" };
}

function convertElement($: cheerio.CheerioAPI, el: cheerio.Cheerio<cheerio.AnyNode>, parts: string[]): void {
  el.contents().each((_, node) => {
    if (node.type === "text") {
      const text = $(node).text().trim();
      if (text) parts.push(text);
      return;
    }

    if (node.type !== "tag") return;
    const tag = (node as cheerio.Element).tagName?.toLowerCase();
    const child = $(node);

    switch (tag) {
      case "h1":
        parts.push(`\n# ${child.text().trim()}\n`);
        break;
      case "h2":
        parts.push(`\n## ${child.text().trim()}\n`);
        break;
      case "h3":
        parts.push(`\n### ${child.text().trim()}\n`);
        break;
      case "h4":
        parts.push(`\n#### ${child.text().trim()}\n`);
        break;
      case "h5":
      case "h6":
        parts.push(`\n##### ${child.text().trim()}\n`);
        break;
      case "p":
        parts.push(`\n${child.text().trim()}\n`);
        break;
      case "pre":
      case "code": {
        const code = child.text().trim();
        if (code) parts.push(`\n\`\`\`\n${code}\n\`\`\`\n`);
        break;
      }
      case "ul":
      case "ol":
        child.children("li").each((i, li) => {
          const prefix = tag === "ol" ? `${i + 1}. ` : "- ";
          parts.push(`${prefix}${$(li).text().trim()}`);
        });
        parts.push("");
        break;
      case "table":
        convertTable($, child, parts);
        break;
      case "br":
        parts.push("");
        break;
      case "a": {
        const href = child.attr("href");
        const text = child.text().trim();
        if (href && text) parts.push(`[${text}](${href})`);
        else if (text) parts.push(text);
        break;
      }
      case "strong":
      case "b":
        parts.push(`**${child.text().trim()}**`);
        break;
      case "em":
      case "i":
        parts.push(`*${child.text().trim()}*`);
        break;
      default:
        // Recurse into containers
        convertElement($, child, parts);
        break;
    }
  });
}

function convertTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<cheerio.AnyNode>, parts: string[]): void {
  const rows: string[][] = [];

  table.find("tr").each((_, tr) => {
    const cells: string[] = [];
    $(tr).find("th, td").each((_, cell) => {
      cells.push($(cell).text().trim().replace(/\|/g, "\\|"));
    });
    if (cells.length > 0) rows.push(cells);
  });

  if (rows.length === 0) return;

  // Normalize column count
  const maxCols = Math.max(...rows.map(r => r.length));
  const normalized = rows.map(r => {
    while (r.length < maxCols) r.push("");
    return r;
  });

  parts.push("");
  parts.push(`| ${normalized[0].join(" | ")} |`);
  parts.push(`| ${normalized[0].map(() => "---").join(" | ")} |`);
  for (let i = 1; i < normalized.length; i++) {
    parts.push(`| ${normalized[i].join(" | ")} |`);
  }
  parts.push("");
}

// ── CSV → Markdown ───────────────────────────────────────────────────

function convertCsvToMarkdown(csv: string): ConvertResult {
  const lines = csv.trim().split("\n");
  if (lines.length === 0) {
    return { markdown: "", title: "Empty CSV", detectedFormat: "csv" };
  }

  // Detect delimiter (comma vs tab vs semicolon)
  const firstLine = lines[0];
  let delimiter = ",";
  if ((firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length) {
    delimiter = "\t";
  } else if ((firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length) {
    delimiter = ";";
  }

  const rows = lines.map(line => parseCsvLine(line, delimiter));
  if (rows.length === 0) {
    return { markdown: "", title: "Empty CSV", detectedFormat: "csv" };
  }

  const maxCols = Math.max(...rows.map(r => r.length));
  const normalized = rows.map(r => {
    while (r.length < maxCols) r.push("");
    return r;
  });

  const header = normalized[0];
  const title = header.join(" / ").slice(0, 100) || "CSV Data";

  const mdLines: string[] = [];
  mdLines.push(`| ${header.map(h => h.replace(/\|/g, "\\|")).join(" | ")} |`);
  mdLines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (let i = 1; i < normalized.length; i++) {
    mdLines.push(`| ${normalized[i].map(c => c.replace(/\|/g, "\\|")).join(" | ")} |`);
  }

  return { markdown: mdLines.join("\n"), title, detectedFormat: "csv" };
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractMarkdownTitle(md: string): string {
  const match = md.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : "Untitled";
}
