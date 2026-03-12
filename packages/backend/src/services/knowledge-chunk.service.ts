/**
 * Knowledge Chunking Service
 *
 * Splits large Markdown documents into smaller, semantically meaningful chunks
 * for better embedding and retrieval quality.
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("knowledge-chunk");

// ── Types ────────────────────────────────────────────────────────────

export type ChunkStrategy = "heading" | "fixed" | "none";

export interface ChunkResult {
  title: string;
  content: string;
  index: number;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Split a Markdown document into chunks based on the chosen strategy.
 */
export function chunkMarkdown(
  markdown: string,
  strategy: ChunkStrategy = "heading",
  options?: {
    /** Max characters per chunk for "fixed" strategy. Default: 4000 */
    maxChunkChars?: number;
    /** Overlap characters for "fixed" strategy. Default: 200 */
    overlapChars?: number;
    /** Document title (used as fallback for chunk titles) */
    documentTitle?: string;
  },
): ChunkResult[] {
  const opts = {
    maxChunkChars: options?.maxChunkChars ?? 4000,
    overlapChars: options?.overlapChars ?? 200,
    documentTitle: options?.documentTitle ?? "Document",
  };

  switch (strategy) {
    case "heading":
      return chunkByHeading(markdown, opts.documentTitle);
    case "fixed":
      return chunkByFixedSize(markdown, opts.maxChunkChars, opts.overlapChars, opts.documentTitle);
    case "none":
      return [{ title: opts.documentTitle, content: markdown, index: 0 }];
    default:
      logger.warn({ strategy }, "unknown chunk strategy, using none");
      return [{ title: opts.documentTitle, content: markdown, index: 0 }];
  }
}

// ── Heading-Based Chunking ───────────────────────────────────────────

function chunkByHeading(markdown: string, documentTitle: string): ChunkResult[] {
  const lines = markdown.split("\n");
  const chunks: ChunkResult[] = [];
  let currentTitle = documentTitle;
  let currentLines: string[] = [];
  let index = 0;

  for (const line of lines) {
    // Match ## or ### headings (not # — that's usually the doc title)
    const headingMatch = line.match(/^(#{2,3})\s+(.+)/);

    if (headingMatch) {
      // Flush previous chunk if it has content
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content.length > 0) {
          chunks.push({ title: currentTitle, content, index });
          index++;
        }
      }
      currentTitle = headingMatch[2].trim();
      currentLines = [line]; // Include the heading in the chunk
    } else {
      currentLines.push(line);
    }
  }

  // Flush final chunk
  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content.length > 0) {
      chunks.push({ title: currentTitle, content, index });
    }
  }

  // If no ## headings were found, return the whole document as one chunk
  if (chunks.length === 0) {
    return [{ title: documentTitle, content: markdown, index: 0 }];
  }

  return chunks;
}

// ── Fixed-Size Chunking ──────────────────────────────────────────────

function chunkByFixedSize(
  markdown: string,
  maxChars: number,
  overlapChars: number,
  documentTitle: string,
): ChunkResult[] {
  if (markdown.length <= maxChars) {
    return [{ title: documentTitle, content: markdown, index: 0 }];
  }

  const chunks: ChunkResult[] = [];
  let start = 0;
  let index = 0;

  while (start < markdown.length) {
    let end = Math.min(start + maxChars, markdown.length);

    // Try to break at a paragraph or line boundary
    if (end < markdown.length) {
      const lastParagraph = markdown.lastIndexOf("\n\n", end);
      if (lastParagraph > start + maxChars / 2) {
        end = lastParagraph;
      } else {
        const lastNewline = markdown.lastIndexOf("\n", end);
        if (lastNewline > start + maxChars / 2) {
          end = lastNewline;
        }
      }
    }

    const content = markdown.slice(start, end).trim();
    if (content.length > 0) {
      // Extract first heading or use generic title
      const headingMatch = content.match(/^#{1,4}\s+(.+)/m);
      const title = headingMatch
        ? headingMatch[1].trim()
        : `${documentTitle} (part ${index + 1})`;

      chunks.push({ title, content, index });
      index++;
    }

    // Move start forward, with overlap
    start = end - overlapChars;
    if (start >= markdown.length) break;
    // Avoid infinite loop if overlap pushes us backward
    if (start <= (chunks.length > 1 ? end - maxChars : 0)) {
      start = end;
    }
  }

  return chunks;
}
