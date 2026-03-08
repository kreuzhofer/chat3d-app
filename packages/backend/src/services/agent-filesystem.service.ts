import { createLogger } from "../utils/logger.js";

const logger = createLogger("agent-fs");

const MAX_PATH_DEPTH = 3;

function validatePath(filePath: string): string | null {
  if (!filePath) {
    return "ERROR: File path cannot be empty.";
  }
  if (filePath.startsWith("/")) {
    return "ERROR: Path must be relative (no leading '/').";
  }
  if (filePath.includes("..")) {
    return "ERROR: Path traversal ('..') is not allowed.";
  }
  const segments = filePath.split("/");
  if (segments.length > MAX_PATH_DEPTH) {
    return `ERROR: Path depth exceeds maximum of ${MAX_PATH_DEPTH} (got ${segments.length} segments).`;
  }
  if (!filePath.endsWith(".py")) {
    return "ERROR: Only .py files are allowed.";
  }
  return null;
}

function formatLineNumbers(content: string, startLine = 1): string {
  const lines = content.split("\n");
  return lines
    .map((line, i) => `${startLine + i}\t${line}`)
    .join("\n");
}

function snippetAround(
  content: string,
  targetLine: number,
  contextLines = 4,
): string {
  const lines = content.split("\n");
  const start = Math.max(0, targetLine - contextLines);
  const end = Math.min(lines.length, targetLine + contextLines + 1);
  const snippet = lines.slice(start, end);
  return snippet.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
}

export class AgentFilesystem {
  private files: Map<string, string> = new Map();

  constructor() {}

  initFromCode(code: string): void {
    this.files.clear();
    this.files.set("main.py", code);
    logger.debug({ fileCount: 1 }, "initialized from single code string");
  }

  initFromFiles(files: Map<string, string>): void {
    this.files.clear();
    for (const [path, content] of files) {
      const err = validatePath(path);
      if (err) {
        logger.warn({ path }, "skipping invalid path during initFromFiles");
        continue;
      }
      this.files.set(path, content);
    }
    logger.debug(
      { fileCount: this.files.size },
      "initialized from file map",
    );
  }

  view(filePath: string, viewRange?: [number, number]): string {
    const pathErr = validatePath(filePath);
    if (pathErr) return pathErr;

    const content = this.files.get(filePath);
    if (content === undefined) {
      return `ERROR: File not found: ${filePath}`;
    }

    if (!viewRange) {
      return formatLineNumbers(content);
    }

    const [startLine, endLine] = viewRange;
    const lines = content.split("\n");

    if (startLine < 1) {
      return "ERROR: viewRange start must be >= 1.";
    }
    if (endLine < startLine) {
      return "ERROR: viewRange end must be >= start.";
    }
    if (startLine > lines.length) {
      return `ERROR: viewRange start (${startLine}) exceeds file length (${lines.length} lines).`;
    }

    const clampedEnd = Math.min(endLine, lines.length);
    const slice = lines.slice(startLine - 1, clampedEnd);
    return slice.map((line, i) => `${startLine + i}\t${line}`).join("\n");
  }

  create(filePath: string, fileText: string): string {
    const pathErr = validatePath(filePath);
    if (pathErr) return pathErr;

    if (this.files.has(filePath)) {
      return `ERROR: File already exists: ${filePath}. Use strReplace to edit existing files.`;
    }

    this.files.set(filePath, fileText);
    logger.debug({ path: filePath }, "file created");
    return `File created successfully at: ${filePath}`;
  }

  strReplace(
    filePath: string,
    oldStr: string,
    newStr: string,
  ): string {
    const pathErr = validatePath(filePath);
    if (pathErr) return pathErr;

    const content = this.files.get(filePath);
    if (content === undefined) {
      return `ERROR: File not found: ${filePath}`;
    }

    // Count occurrences of oldStr
    let count = 0;
    let searchFrom = 0;
    let firstIndex = -1;
    while (true) {
      const idx = content.indexOf(oldStr, searchFrom);
      if (idx === -1) break;
      if (count === 0) firstIndex = idx;
      count++;
      searchFrom = idx + 1;
    }

    if (count === 0) {
      return `ERROR: No match found for the provided old_str in ${filePath}. Make sure the old_str is an exact match of the existing content, including whitespace and indentation.`;
    }
    if (count > 1) {
      return `ERROR: Found ${count} matches for the provided old_str in ${filePath}. The old_str must match exactly one location. Add more surrounding context to make it unique.`;
    }

    const newContent =
      content.substring(0, firstIndex) +
      newStr +
      content.substring(firstIndex + oldStr.length);
    this.files.set(filePath, newContent);

    // Calculate the line number of the replacement for the snippet
    const lineNumber =
      content.substring(0, firstIndex).split("\n").length;
    const snippet = snippetAround(newContent, lineNumber - 1);

    logger.debug({ path: filePath, line: lineNumber }, "str_replace applied");
    return `The file ${filePath} has been edited. Here's the result of running \`cat -n\` on a snippet of the edited file:\n${snippet}`;
  }

  insert(
    filePath: string,
    insertLine: number,
    insertText: string,
  ): string {
    const pathErr = validatePath(filePath);
    if (pathErr) return pathErr;

    const content = this.files.get(filePath);
    if (content === undefined) {
      return `ERROR: File not found: ${filePath}`;
    }

    const lines = content.split("\n");

    if (insertLine < 0) {
      return "ERROR: insertLine must be >= 0.";
    }
    if (insertLine > lines.length) {
      return `ERROR: insertLine (${insertLine}) exceeds file length (${lines.length} lines).`;
    }

    const newLines = insertText.split("\n");

    // insertLine 0 means prepend, otherwise insert after insertLine
    lines.splice(insertLine, 0, ...newLines);
    const newContent = lines.join("\n");
    this.files.set(filePath, newContent);

    const snippet = snippetAround(newContent, insertLine);

    logger.debug(
      { path: filePath, line: insertLine, linesInserted: newLines.length },
      "insert applied",
    );
    return `The file ${filePath} has been edited. Here's the result of running \`cat -n\` on a snippet of the edited file:\n${snippet}`;
  }

  listDirectory(dirPath?: string): string {
    const normalizedDir = dirPath
      ? dirPath.replace(/\/+$/, "")
      : "";

    if (normalizedDir) {
      if (normalizedDir.includes("..")) {
        return "ERROR: Path traversal ('..') is not allowed.";
      }
      if (normalizedDir.startsWith("/")) {
        return "ERROR: Path must be relative (no leading '/').";
      }
    }

    const entries = new Set<string>();

    for (const path of this.files.keys()) {
      if (normalizedDir) {
        if (!path.startsWith(normalizedDir + "/")) continue;
        const rest = path.substring(normalizedDir.length + 1);
        const firstSegment = rest.split("/")[0];
        entries.add(
          rest.includes("/") ? firstSegment + "/" : firstSegment,
        );
      } else {
        const firstSegment = path.split("/")[0];
        entries.add(
          path.includes("/") ? firstSegment + "/" : firstSegment,
        );
      }
    }

    if (entries.size === 0) {
      const label = normalizedDir || ".";
      return `Directory listing for ${label}:\n(empty)`;
    }

    const sorted = Array.from(entries).sort();
    const label = normalizedDir || ".";
    return `Directory listing for ${label}:\n${sorted.join("\n")}`;
  }

  getFiles(): Array<{ path: string; content: string }> {
    const result: Array<{ path: string; content: string }> = [];
    for (const [path, content] of this.files) {
      result.push({ path, content });
    }
    return result;
  }

  getMainCode(): string | null {
    return this.files.get("main.py") ?? null;
  }

  hasMultipleFiles(): boolean {
    return this.files.size > 1;
  }

  getFileCount(): number {
    return this.files.size;
  }
}
