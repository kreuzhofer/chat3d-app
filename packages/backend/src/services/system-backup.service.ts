/**
 * System Backup Service
 *
 * Full system export/restore: PostgreSQL database + file storage volume.
 * Uses the same background job + polling pattern as workbench-data-transfer.service.ts.
 *
 * Export: pg_dump (custom format) + tar.gz of /data/storage → single .tar.gz archive.
 * Restore: extract archive → pg_restore → replace storage files.
 */

import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import archiver from "archiver";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { createBackup } from "./backup.service.js";

const execFile = promisify(execFileCb);
const logger = createLogger("system-backup");

const EXPORT_VERSION = 1;
const BACKUPS_SUBDIR = "system-backups";
/** Directories that contain backup archives — excluded from system backups. */
const EXCLUDED_DIRS = [BACKUPS_SUBDIR, "workbench-exports", "knowledge-exports"];

// ── Types ────────────────────────────────────────────────────────────

export interface SystemBackupJob {
  jobId: string;
  type: "export" | "restore";
  status: "running" | "completed" | "failed";
  progress: { phase: string; detail?: string };
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface BackupManifest {
  version: number;
  createdAt: string;
  database: { host: string; name: string };
  storageIncluded: boolean;
}

// ── In-memory job store ──────────────────────────────────────────────

const jobs = new Map<string, SystemBackupJob>();
let jobCounter = 0;

function generateJobId(type: "export" | "restore"): string {
  jobCounter += 1;
  return `sys-${type}-${Date.now()}-${jobCounter}`;
}

function getBackupsDir(): string {
  return path.join(config.storage.rootDir, BACKUPS_SUBDIR);
}

function pgEnv(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    PGPASSWORD: config.db.password,
  };
}

// ── Public API ───────────────────────────────────────────────────────

export function startSystemExport(): SystemBackupJob {
  const jobId = generateJobId("export");
  const job: SystemBackupJob = {
    jobId,
    type: "export",
    status: "running",
    progress: { phase: "starting" },
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);
  void runExport(job);
  return job;
}

export function startSystemRestore(archivePath: string): SystemBackupJob {
  const jobId = generateJobId("restore");
  const job: SystemBackupJob = {
    jobId,
    type: "restore",
    status: "running",
    progress: { phase: "starting" },
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);
  void runRestore(job, archivePath);
  return job;
}

export function getSystemBackupJob(jobId: string): SystemBackupJob | null {
  return jobs.get(jobId) ?? null;
}

export function listSystemBackupJobs(): SystemBackupJob[] {
  return Array.from(jobs.values()).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

// ── Export logic ─────────────────────────────────────────────────────

async function runExport(job: SystemBackupJob): Promise<void> {
  const backupsDir = getBackupsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = path.join(backupsDir, `temp-db-${timestamp}.dump`);
  const archivePath = path.join(backupsDir, `chat3d-system-${timestamp}.tar.gz`);

  try {
    await fs.mkdir(backupsDir, { recursive: true });

    // 1. Database dump
    job.progress = { phase: "dumping database" };
    logger.info("starting pg_dump");
    await execFile("pg_dump", [
      "-h", config.db.host,
      "-p", String(config.db.port),
      "-U", config.db.user,
      "-d", config.db.database,
      "-Fc",
      "-f", dumpPath,
    ], { env: pgEnv(), maxBuffer: 50 * 1024 * 1024 });
    const dumpStat = await fs.stat(dumpPath);
    logger.info({ sizeBytes: dumpStat.size }, "pg_dump complete");

    // 2. Archive: manifest + db dump + storage files
    job.progress = { phase: "archiving files" };
    logger.info("creating archive");
    await writeArchive(archivePath, dumpPath, job);

    // 3. Clean up temp dump
    await fs.unlink(dumpPath).catch(() => {});

    // 4. Register backup record
    job.progress = { phase: "finalizing" };
    const archiveStat = await fs.stat(archivePath);
    const fileName = path.basename(archivePath);
    await createBackup({
      type: "system",
      label: `System backup ${new Date().toLocaleDateString()}`,
      fileName,
      filePath: archivePath,
      sizeBytes: BigInt(archiveStat.size),
      status: "completed",
    });

    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    logger.info({ archivePath, sizeBytes: archiveStat.size }, "system export completed");
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
    logger.error({ err }, "system export failed");
    // Clean up partial files
    await fs.unlink(dumpPath).catch(() => {});
    await fs.unlink(archivePath).catch(() => {});
  }
}

async function writeArchive(
  archivePath: string,
  dumpPath: string,
  job: SystemBackupJob,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(archivePath);
    const archive = archiver("tar", { gzip: true, gzipOptions: { level: 6 } });

    writeStream.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));
    archive.on("warning", (err: Error) => {
      logger.warn({ err }, "archiver warning");
    });

    archive.pipe(writeStream);

    // Add manifest
    const manifest: BackupManifest = {
      version: EXPORT_VERSION,
      createdAt: new Date().toISOString(),
      database: { host: config.db.host, name: config.db.database },
      storageIncluded: true,
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

    // Add database dump
    archive.file(dumpPath, { name: "database.dump" });

    // Add storage directory (exclude backup archive directories)
    const storageRoot = config.storage.rootDir;
    archive.directory(storageRoot, "storage", (entry) => {
      for (const dir of EXCLUDED_DIRS) {
        if (entry.name === dir || entry.name.startsWith(`${dir}/`)) {
          return false;
        }
      }
      return entry;
    });

    job.progress = { phase: "archiving files", detail: "compressing..." };
    void archive.finalize();
  });
}

// ── Restore logic ────────────────────────────────────────────────────

async function runRestore(job: SystemBackupJob, archivePath: string): Promise<void> {
  const tempDir = path.join(getBackupsDir(), `restore-${Date.now()}`);

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // 1. Extract archive
    job.progress = { phase: "extracting archive" };
    logger.info({ archivePath }, "extracting system backup");
    await execFile("tar", ["xzf", archivePath, "-C", tempDir], {
      maxBuffer: 10 * 1024 * 1024,
    });

    // 2. Verify manifest
    job.progress = { phase: "verifying backup" };
    const manifestPath = path.join(tempDir, "manifest.json");
    const manifestData = await fs.readFile(manifestPath, "utf-8");
    const manifest: BackupManifest = JSON.parse(manifestData);
    if (!manifest.version || manifest.version > EXPORT_VERSION) {
      throw new Error(`Unsupported backup version: ${manifest.version}`);
    }
    logger.info({ manifest }, "backup manifest verified");

    // 3. Restore storage files first (less destructive if DB restore fails)
    if (manifest.storageIncluded) {
      job.progress = { phase: "restoring files" };
      const extractedStorage = path.join(tempDir, "storage");
      const storageStat = await fs.stat(extractedStorage).catch(() => null);
      if (storageStat?.isDirectory()) {
        await restoreStorageFiles(extractedStorage);
        logger.info("storage files restored");
      }
    }

    // 4. Restore database
    job.progress = { phase: "restoring database" };
    const dumpFile = path.join(tempDir, "database.dump");
    const dumpStat = await fs.stat(dumpFile).catch(() => null);
    if (!dumpStat) {
      throw new Error("database.dump not found in archive");
    }
    logger.info("starting pg_restore");
    await execFile("pg_restore", [
      "-h", config.db.host,
      "-p", String(config.db.port),
      "-U", config.db.user,
      "-d", config.db.database,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      dumpFile,
    ], { env: pgEnv(), maxBuffer: 50 * 1024 * 1024 });
    logger.info("pg_restore complete");

    // 5. Clean up
    job.progress = { phase: "cleaning up" };
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.unlink(archivePath).catch(() => {});

    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    logger.warn("system restore completed — server restart recommended");
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
    logger.error({ err }, "system restore failed");
    // Best-effort cleanup
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function restoreStorageFiles(extractedStorage: string): Promise<void> {
  const storageRoot = config.storage.rootDir;
  const backupsDir = path.join(storageRoot, BACKUPS_SUBDIR);

  // Preserve the system-backups directory
  const tempBackups = path.join(storageRoot, `_${BACKUPS_SUBDIR}_preserve`);
  const backupsExist = await fs.stat(backupsDir).then(() => true).catch(() => false);
  if (backupsExist) {
    await fs.rename(backupsDir, tempBackups);
  }

  // Remove everything except the preserved backups dir
  const entries = await fs.readdir(storageRoot);
  for (const entry of entries) {
    if (entry === `_${BACKUPS_SUBDIR}_preserve`) continue;
    await fs.rm(path.join(storageRoot, entry), { recursive: true, force: true });
  }

  // Copy restored files in
  const restoredEntries = await fs.readdir(extractedStorage);
  for (const entry of restoredEntries) {
    if (entry === BACKUPS_SUBDIR) continue; // Skip system-backups from archive
    await fs.cp(
      path.join(extractedStorage, entry),
      path.join(storageRoot, entry),
      { recursive: true },
    );
  }

  // Restore preserved backups dir
  if (backupsExist) {
    await fs.rename(tempBackups, backupsDir);
  }
}
