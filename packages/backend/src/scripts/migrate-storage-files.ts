/**
 * v2_file_restructure — One-time storage migration
 *
 * Restructures flat file layouts into code/ + artifacts/ subdirectories
 * for both chat and workbench domains. Also rewrites DB path references.
 *
 * Idempotent: checks if files already exist in target location before moving.
 * Tracked in data_migrations table to prevent re-execution.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("file-migrate");

const MODEL_EXTENSIONS = new Set(["stl", "step", "3mf"]);
const CODE_EXTENSIONS = new Set(["b123d"]);

interface MigrationStats {
  chatFilesMoved: number;
  chatPathsUpdated: number;
  workbenchFilesMoved: number;
  workbenchPathsUpdated: number;
  errors: string[];
}

/**
 * Move a file if source exists and target does not.
 * Creates target directory if needed. Returns true if moved.
 */
async function moveFile(srcAbs: string, dstAbs: string): Promise<boolean> {
  try {
    await fs.access(srcAbs);
  } catch {
    return false; // source doesn't exist
  }

  try {
    await fs.access(dstAbs);
    return false; // target already exists — idempotent skip
  } catch {
    // Target doesn't exist — proceed with move
  }

  await fs.mkdir(path.dirname(dstAbs), { recursive: true });
  await fs.rename(srcAbs, dstAbs);
  return true;
}

/**
 * Classify a filename in a flat directory into code/ or artifacts/ subdirectory.
 * Returns null if the file should be left in place (e.g., user uploads).
 */
function classifyFile(fileName: string): { subdir: "code" | "artifacts"; fileName: string } | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return null;

  if (CODE_EXTENSIONS.has(ext)) {
    return { subdir: "code", fileName };
  }

  if (MODEL_EXTENSIONS.has(ext)) {
    return { subdir: "artifacts", fileName };
  }

  // Screenshots: {id}-screenshot-{angle}.png
  if (ext === "png" && fileName.includes("-screenshot-")) {
    return { subdir: "artifacts", fileName };
  }

  return null; // Unknown file type — leave in place
}

// ── Chat file migration ──────────────────────────────────────────────

async function migrateChatFiles(rootDir: string, stats: MigrationStats): Promise<void> {
  const chatDir = path.join(rootDir, "chat");
  try {
    await fs.access(chatDir);
  } catch {
    logger.info("no chat/ directory found — skipping chat file migration");
    return;
  }

  const contextDirs = await fs.readdir(chatDir, { withFileTypes: true });

  for (const entry of contextDirs) {
    if (!entry.isDirectory()) continue;
    const contextId = entry.name;
    // Skip code/ and artifacts/ directories (already migrated structure)
    if (contextId === "code" || contextId === "artifacts") continue;

    const contextDir = path.join(chatDir, contextId);
    const files = await fs.readdir(contextDir, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile()) continue;
      const classification = classifyFile(file.name);
      if (!classification) continue;

      // Skip files that contain the contextId pattern (user uploads: {contextId}-{uuid}.ext)
      if (file.name.startsWith(contextId)) continue;

      const srcAbs = path.join(contextDir, file.name);
      const dstAbs = path.join(contextDir, classification.subdir, file.name);

      try {
        if (await moveFile(srcAbs, dstAbs)) {
          stats.chatFilesMoved++;
          logger.debug({ src: `chat/${contextId}/${file.name}`, dst: `chat/${contextId}/${classification.subdir}/${file.name}` }, "moved chat file");
        }
      } catch (err) {
        const msg = `Failed to move chat/${contextId}/${file.name}: ${err instanceof Error ? err.message : String(err)}`;
        stats.errors.push(msg);
        logger.warn({ err }, msg);
      }
    }
  }
}

async function updateChatItemPaths(stats: MigrationStats): Promise<void> {
  // Find chat items that have file paths in messages JSONB
  // JSONB text serialization may have varying whitespace, so use a broad match
  const items = await prisma.$queryRaw<Array<{ id: string; messages: unknown }>>`
    SELECT id, messages FROM chat_items
    WHERE messages::text LIKE '%"path"%chat/%'
  `;

  for (const item of items) {
    const messages = item.messages as Array<Record<string, unknown>>;
    if (!Array.isArray(messages)) continue;

    let changed = false;
    const updated = messages.map((msg) => {
      if (typeof msg !== "object" || msg === null) return msg;
      const newMsg = { ...msg };

      // Rewrite path fields
      if (typeof newMsg.path === "string" && newMsg.path.startsWith("chat/")) {
        const rewritten = rewriteChatPath(newMsg.path as string);
        if (rewritten !== newMsg.path) {
          newMsg.path = rewritten;
          changed = true;
        }
      }

      // Also check nested files arrays
      if (Array.isArray(newMsg.files)) {
        const newFiles = (newMsg.files as Array<Record<string, unknown>>).map((f) => {
          if (typeof f?.path === "string" && (f.path as string).startsWith("chat/")) {
            const rewritten = rewriteChatPath(f.path as string);
            if (rewritten !== f.path) {
              changed = true;
              return { ...f, path: rewritten };
            }
          }
          return f;
        });
        newMsg.files = newFiles;
      }

      return newMsg;
    });

    if (changed) {
      await prisma.chatItem.update({
        where: { id: item.id },
        data: { messages: updated as unknown as object[] },
      });
      stats.chatPathsUpdated++;
    }
  }
}

function rewriteChatPath(p: string): string {
  // Pattern: chat/{contextId}/{itemId}.{ext}
  // Rewrite to: chat/{contextId}/artifacts/{itemId}.{ext} or chat/{contextId}/code/{itemId}.b123d
  const segments = p.split("/");
  if (segments.length !== 3) return p; // Already in subdirectory or unexpected format
  // segments = ["chat", contextId, "filename.ext"]
  const fileName = segments[2];
  const classification = classifyFile(fileName);
  if (!classification) return p;
  return `chat/${segments[1]}/${classification.subdir}/${fileName}`;
}

// ── Workbench file migration ─────────────────────────────────────────

async function migrateWorkbenchFiles(rootDir: string, stats: MigrationStats): Promise<void> {
  const wbDir = path.join(rootDir, "workbench");
  try {
    await fs.access(wbDir);
  } catch {
    logger.info("no workbench/ directory found — skipping workbench file migration");
    return;
  }

  const categoryDirs = await fs.readdir(wbDir, { withFileTypes: true });

  for (const entry of categoryDirs) {
    if (!entry.isDirectory()) continue;
    const categoryId = entry.name;
    // Skip non-UUID-looking directories (like workbench-exports)
    if (categoryId.includes("-export") || categoryId === "code" || categoryId === "artifacts") continue;

    const categoryDir = path.join(wbDir, categoryId);
    const files = await fs.readdir(categoryDir, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile()) continue;
      const classification = classifyFile(file.name);
      if (!classification) continue;

      const srcAbs = path.join(categoryDir, file.name);
      const dstAbs = path.join(categoryDir, classification.subdir, file.name);

      try {
        if (await moveFile(srcAbs, dstAbs)) {
          stats.workbenchFilesMoved++;
          logger.debug({ src: `workbench/${categoryId}/${file.name}`, dst: `workbench/${categoryId}/${classification.subdir}/${file.name}` }, "moved workbench file");
        }
      } catch (err) {
        const msg = `Failed to move workbench/${categoryId}/${file.name}: ${err instanceof Error ? err.message : String(err)}`;
        stats.errors.push(msg);
        logger.warn({ err }, msg);
      }
    }
  }
}

async function updateWorkbenchExamplePaths(stats: MigrationStats): Promise<void> {
  const examples = await prisma.workbenchExample.findMany({
    where: {
      OR: [
        { stlPath: { startsWith: "workbench/", not: { contains: "/artifacts/" } } },
        { stepPath: { startsWith: "workbench/", not: { contains: "/artifacts/" } } },
        { threemfPath: { startsWith: "workbench/", not: { contains: "/artifacts/" } } },
      ],
    },
    select: {
      id: true,
      stlPath: true,
      stepPath: true,
      threemfPath: true,
      screenshotFront: true,
      screenshotBack: true,
      screenshotLeft: true,
      screenshotRight: true,
      screenshotTop: true,
      screenshotBottom: true,
      screenshotOrtho45: true,
      screenshotOrtho45Bottom: true,
      screenshotIso: true,
      screenshotIsoBack: true,
    },
  });

  for (const ex of examples) {
    const data: Record<string, string | null> = {};

    // Rewrite model file paths
    if (ex.stlPath) data.stlPath = rewriteWorkbenchPath(ex.stlPath, "artifacts");
    if (ex.stepPath) data.stepPath = rewriteWorkbenchPath(ex.stepPath, "artifacts");
    if (ex.threemfPath) data.threemfPath = rewriteWorkbenchPath(ex.threemfPath, "artifacts");

    // Rewrite screenshot paths
    const screenshotFields = [
      "screenshotFront", "screenshotBack", "screenshotLeft", "screenshotRight",
      "screenshotTop", "screenshotBottom", "screenshotOrtho45", "screenshotOrtho45Bottom",
      "screenshotIso", "screenshotIsoBack",
    ] as const;
    for (const field of screenshotFields) {
      const val = ex[field];
      if (val && val.startsWith("workbench/") && !val.includes("/artifacts/")) {
        data[field] = rewriteWorkbenchPath(val, "artifacts");
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.workbenchExample.update({ where: { id: ex.id }, data });
      stats.workbenchPathsUpdated++;
    }
  }
}

function rewriteWorkbenchPath(p: string, subdir: string): string {
  // Pattern: workbench/{categoryId}/{filename}
  // Rewrite to: workbench/{categoryId}/{subdir}/{filename}
  const segments = p.split("/");
  if (segments.length !== 3) return p; // Already in subdirectory
  return `${segments[0]}/${segments[1]}/${subdir}/${segments[2]}`;
}

// ── Main entry point ─────────────────────────────────────────────────

export async function runFileRestructureMigration(): Promise<MigrationStats> {
  const rootDir = config.storage.rootDir;
  const stats: MigrationStats = {
    chatFilesMoved: 0,
    chatPathsUpdated: 0,
    workbenchFilesMoved: 0,
    workbenchPathsUpdated: 0,
    errors: [],
  };

  logger.info({ rootDir }, "starting v2_file_restructure migration");

  // Phase 1: Move files on disk
  await migrateChatFiles(rootDir, stats);
  await migrateWorkbenchFiles(rootDir, stats);

  // Phase 2: Update DB paths
  await updateChatItemPaths(stats);
  await updateWorkbenchExamplePaths(stats);

  logger.info(
    {
      chatFilesMoved: stats.chatFilesMoved,
      chatPathsUpdated: stats.chatPathsUpdated,
      workbenchFilesMoved: stats.workbenchFilesMoved,
      workbenchPathsUpdated: stats.workbenchPathsUpdated,
      errorCount: stats.errors.length,
    },
    "v2_file_restructure migration completed",
  );

  return stats;
}
