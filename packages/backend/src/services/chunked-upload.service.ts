/**
 * Chunked Upload Service
 *
 * Manages resumable file uploads by splitting large files into chunks.
 * Each upload session has an ID; chunks are written to a temp directory
 * and assembled into a final file on completion.
 *
 * Sessions expire after 30 minutes of inactivity (checked every 5 minutes).
 */

import { promises as fs } from "node:fs";
import { createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("chunked-upload");

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;  // 5 MB
const MAX_CHUNK_SIZE = 20 * 1024 * 1024;     // 20 MB
const SESSION_TTL_MS = 30 * 60 * 1000;       // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes

// ── Types ────────────────────────────────────────────────────────────

interface UploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  chunksDir: string;
  assembled: boolean;
  assembledPath: string | null;
  lastActivity: number;
}

export interface UploadInitResult {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

export interface UploadStatusResult {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  assembled: boolean;
}

// ── In-memory session store ──────────────────────────────────────────

const sessions = new Map<string, UploadSession>();

// Start stale session cleanup
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      logger.info({ uploadId: id }, "cleaning up stale upload session");
      void cleanupSession(session);
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // Don't block process exit

// ── Helpers ──────────────────────────────────────────────────────────

function getUploadsBaseDir(): string {
  return path.join(config.storage.rootDir, "workbench-exports");
}

async function cleanupSession(session: UploadSession): Promise<void> {
  try {
    await fs.rm(session.chunksDir, { recursive: true, force: true });
  } catch (err) {
    logger.debug({ uploadId: session.uploadId, err }, "cleanup failed (may already be removed)");
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Initialize a new chunked upload session.
 */
export async function initUpload(
  fileName: string,
  fileSize: number,
  chunkSize?: number,
): Promise<UploadInitResult> {
  const resolvedChunkSize = Math.min(chunkSize ?? DEFAULT_CHUNK_SIZE, MAX_CHUNK_SIZE);
  if (resolvedChunkSize <= 0) {
    throw new Error("chunkSize must be positive");
  }
  if (fileSize <= 0) {
    throw new Error("fileSize must be positive");
  }

  const totalChunks = Math.ceil(fileSize / resolvedChunkSize);
  const uploadId = crypto.randomUUID();
  const chunksDir = path.join(getUploadsBaseDir(), `chunks-${uploadId}`);

  await fs.mkdir(chunksDir, { recursive: true });

  const session: UploadSession = {
    uploadId,
    fileName,
    fileSize,
    chunkSize: resolvedChunkSize,
    totalChunks,
    receivedChunks: new Set(),
    chunksDir,
    assembled: false,
    assembledPath: null,
    lastActivity: Date.now(),
  };

  sessions.set(uploadId, session);

  logger.info(
    { uploadId, fileName, fileSize, chunkSize: resolvedChunkSize, totalChunks },
    "upload session initialized",
  );

  return { uploadId, chunkSize: resolvedChunkSize, totalChunks };
}

/**
 * Receive and store a single chunk.
 */
export async function receiveChunk(
  uploadId: string,
  chunkIndex: number,
  data: Buffer,
): Promise<{ received: true }> {
  const session = sessions.get(uploadId);
  if (!session) throw new Error("Upload session not found");
  if (session.assembled) throw new Error("Upload already assembled");
  if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new Error(`chunkIndex ${chunkIndex} out of range [0, ${session.totalChunks})`);
  }

  const chunkPath = path.join(session.chunksDir, String(chunkIndex));
  await fs.writeFile(chunkPath, data);
  session.receivedChunks.add(chunkIndex);
  session.lastActivity = Date.now();

  logger.debug(
    { uploadId, chunkIndex, received: session.receivedChunks.size, total: session.totalChunks },
    "chunk received",
  );

  return { received: true };
}

/**
 * Get the current upload status.
 */
export function getUploadStatus(uploadId: string): UploadStatusResult | null {
  const session = sessions.get(uploadId);
  if (!session) return null;

  return {
    uploadId: session.uploadId,
    fileName: session.fileName,
    fileSize: session.fileSize,
    chunkSize: session.chunkSize,
    totalChunks: session.totalChunks,
    uploadedChunks: Array.from(session.receivedChunks).sort((a, b) => a - b),
    assembled: session.assembled,
  };
}

/**
 * Assemble all received chunks into a single file.
 * Returns the path to the assembled file.
 */
export async function assembleChunks(uploadId: string): Promise<string> {
  const session = sessions.get(uploadId);
  if (!session) throw new Error("Upload session not found");
  if (session.assembled && session.assembledPath) return session.assembledPath;

  // Verify all chunks are present
  for (let i = 0; i < session.totalChunks; i++) {
    if (!session.receivedChunks.has(i)) {
      throw new Error(`Missing chunk ${i} of ${session.totalChunks}`);
    }
  }

  // Assemble into final file
  const assembledPath = path.join(getUploadsBaseDir(), `upload-${uploadId}-${session.fileName}`);

  logger.info({ uploadId, totalChunks: session.totalChunks, assembledPath }, "assembling chunks");

  const writeStream = createWriteStream(assembledPath);

  for (let i = 0; i < session.totalChunks; i++) {
    const chunkPath = path.join(session.chunksDir, String(i));
    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(chunkPath);
      readStream.on("error", reject);
      readStream.on("end", resolve);
      readStream.pipe(writeStream, { end: false });
    });
  }

  writeStream.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  session.assembled = true;
  session.assembledPath = assembledPath;
  session.lastActivity = Date.now();

  // Clean up chunk files
  await cleanupSession(session);

  logger.info({ uploadId, assembledPath }, "chunks assembled");

  return assembledPath;
}

/**
 * Delete an upload session and all its data.
 */
export async function deleteUpload(uploadId: string): Promise<void> {
  const session = sessions.get(uploadId);
  if (!session) return;

  await cleanupSession(session);

  // Also remove assembled file if it exists
  if (session.assembledPath) {
    try {
      await fs.unlink(session.assembledPath);
    } catch {
      // Non-fatal
    }
  }

  sessions.delete(uploadId);
  logger.info({ uploadId }, "upload session deleted");
}
