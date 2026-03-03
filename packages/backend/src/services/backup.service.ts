/**
 * Backup Service
 *
 * Manages persistent backup records in the database.
 * Backups track exported files (workbench ZIPs, future: DB dumps)
 * so they survive server restarts.
 */

import { promises as fs } from "node:fs";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("backup");

// ── Types ────────────────────────────────────────────────────────────

export interface CreateBackupInput {
  type: string;
  label: string;
  fileName: string;
  filePath: string;
  sizeBytes?: bigint;
  status?: string;
  counts?: Record<string, number>;
  error?: string;
  completedAt?: Date;
}

export interface BackupRecord {
  id: string;
  type: string;
  label: string;
  fileName: string;
  filePath: string;
  sizeBytes: string | null;
  status: string;
  counts: Record<string, number> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function toRecord(row: {
  id: string;
  type: string;
  label: string;
  fileName: string;
  filePath: string;
  sizeBytes: bigint | null;
  status: string;
  counts: unknown;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): BackupRecord {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    fileName: row.fileName,
    filePath: row.filePath,
    sizeBytes: row.sizeBytes !== null ? row.sizeBytes.toString() : null,
    status: row.status,
    counts: (row.counts as Record<string, number>) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// ── Public API ───────────────────────────────────────────────────────

export async function createBackup(input: CreateBackupInput): Promise<BackupRecord> {
  const row = await prisma.backup.create({
    data: {
      type: input.type,
      label: input.label,
      fileName: input.fileName,
      filePath: input.filePath,
      sizeBytes: input.sizeBytes ?? null,
      status: input.status ?? "completed",
      counts: input.counts ?? undefined,
      error: input.error ?? null,
      completedAt: input.completedAt ?? new Date(),
    },
  });

  logger.info({ id: row.id, type: input.type, fileName: input.fileName }, "backup record created");
  return toRecord(row);
}

export async function listBackups(type?: string): Promise<BackupRecord[]> {
  const rows = await prisma.backup.findMany({
    where: type ? { type } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toRecord);
}

export async function getBackup(id: string): Promise<BackupRecord | null> {
  const row = await prisma.backup.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

/**
 * Delete any backup record matching the given file path (DB record only, no file deletion).
 * Used when the caller has already deleted the file (e.g. transfer job cleanup).
 */
export async function deleteBackupByFilePath(filePath: string): Promise<number> {
  const { count } = await prisma.backup.deleteMany({ where: { filePath } });
  if (count > 0) {
    logger.info({ filePath, count }, "deleted backup record(s) by file path");
  }
  return count;
}

export async function deleteBackup(id: string): Promise<"deleted" | "not_found"> {
  const row = await prisma.backup.findUnique({ where: { id } });
  if (!row) return "not_found";

  // Delete file from disk (best-effort)
  try {
    await fs.unlink(row.filePath);
    logger.info({ id, filePath: row.filePath }, "deleted backup file");
  } catch (err) {
    logger.debug({ id, filePath: row.filePath, err }, "backup file already removed or inaccessible");
  }

  await prisma.backup.delete({ where: { id } });
  logger.info({ id, type: row.type }, "backup record deleted");
  return "deleted";
}
