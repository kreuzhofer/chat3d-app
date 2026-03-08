/**
 * Job Queue Service — pg-boss backed persistent job queue.
 *
 * Manages background jobs for knowledge pipeline operations:
 *   - knowledge.crawl   — crawl a single source
 *   - knowledge.validate — validate pending entries
 *   - knowledge.embed   — embed valid entries
 *
 * Started with the Express server. Workers run in-process.
 */

import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { crawlSource } from "./knowledge-crawl.service.js";
import { validatePendingEntries, backfillKnowledgeEmbeddings } from "./knowledge.service.js";

const logger = createLogger("job-queue");

// ── Job Types ────────────────────────────────────────────────────────

interface CrawlJobData {
  sourceId: string;
}

interface ValidateJobData {
  sourceId?: string;
  revalidateAll?: boolean;
}

// Embed has no payload — it processes all valid-but-unembedded entries
type EmbedJobData = Record<string, never>;

export type KnowledgeJobType = "knowledge.crawl" | "knowledge.validate" | "knowledge.embed";

export interface JobStatus {
  id: string;
  name: string;
  state: string;
  data: unknown;
  createdOn: Date;
  startedOn: Date | null;
  completedOn: Date | null;
  output: unknown;
}

// ── Singleton ────────────────────────────────────────────────────────

let boss: PgBoss | null = null;

function buildConnectionString(): string {
  const db = config.db;
  return `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/${db.database}`;
}

/**
 * Start pg-boss and register workers. Call once at server startup.
 */
export async function startJobQueue(): Promise<void> {
  if (boss) {
    logger.warn("job queue already started");
    return;
  }

  boss = new PgBoss({
    connectionString: buildConnectionString(),
    schema: "pgboss",
  });

  boss.on("error", (err) => {
    logger.error({ err }, "pg-boss error");
  });

  await boss.start();
  logger.info("pg-boss started");

  // Create queues (required in pg-boss v12+)
  const queueOpts = {
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: 10,
    expireInSeconds: 3600, // 1 hour
    deleteAfterSeconds: 86400, // keep completed jobs for 24h
    retentionSeconds: 604800, // 7 days
  };
  await boss.createQueue("knowledge.crawl", queueOpts);
  await boss.createQueue("knowledge.validate", queueOpts);
  await boss.createQueue("knowledge.embed", queueOpts);
  logger.info("knowledge job queues created");

  // Register workers (pg-boss v12: WorkHandler receives Job[] array)
  await boss.work<CrawlJobData>("knowledge.crawl", { localConcurrency: 1 }, async (jobs) => {
    const job = jobs[0];
    logger.info({ jobId: job.id, sourceId: job.data.sourceId }, "processing crawl job");
    const result = await crawlSource(job.data.sourceId);
    return result;
  });

  await boss.work<ValidateJobData>("knowledge.validate", { localConcurrency: 1 }, async (jobs) => {
    const job = jobs[0];
    logger.info({ jobId: job.id, revalidateAll: job.data.revalidateAll }, "processing validate job");
    const result = await validatePendingEntries({
      sourceId: job.data.sourceId,
      revalidateAll: job.data.revalidateAll,
    });
    return result;
  });

  await boss.work<EmbedJobData>("knowledge.embed", { localConcurrency: 1 }, async (jobs) => {
    const job = jobs[0];
    logger.info({ jobId: job.id }, "processing embed job");
    const result = await backfillKnowledgeEmbeddings();
    return result;
  });

  logger.info("knowledge job workers registered");
}

/**
 * Stop pg-boss gracefully. Call on server shutdown.
 */
export async function stopJobQueue(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 10000 });
  boss = null;
  logger.info("pg-boss stopped");
}

// ── Job Submission ───────────────────────────────────────────────────

/**
 * Submit a crawl job for a specific source.
 */
export async function submitCrawlJob(sourceId: string): Promise<string | null> {
  if (!boss) throw new Error("Job queue not started");

  const jobId = await boss.send("knowledge.crawl", { sourceId }, {
    singletonKey: `crawl-${sourceId}`,
    singletonSeconds: 60, // prevent duplicate crawls within 60s
  });

  logger.info({ jobId, sourceId }, "crawl job submitted");
  return jobId;
}

/**
 * Submit a validation job.
 */
export async function submitValidateJob(opts?: {
  sourceId?: string;
  revalidateAll?: boolean;
}): Promise<string | null> {
  if (!boss) throw new Error("Job queue not started");

  const jobId = await boss.send("knowledge.validate", opts ?? {}, {
    singletonKey: opts?.revalidateAll ? "validate-all" : "validate-pending",
    singletonSeconds: 30,
  });

  logger.info({ jobId, revalidateAll: opts?.revalidateAll }, "validate job submitted");
  return jobId;
}

/**
 * Submit an embed job.
 */
export async function submitEmbedJob(): Promise<string | null> {
  if (!boss) throw new Error("Job queue not started");

  const jobId = await boss.send("knowledge.embed", {}, {
    singletonKey: "embed",
    singletonSeconds: 30,
  });

  logger.info({ jobId }, "embed job submitted");
  return jobId;
}

const KNOWLEDGE_QUEUES: KnowledgeJobType[] = ["knowledge.crawl", "knowledge.validate", "knowledge.embed"];

/**
 * Get the status of a specific job by ID.
 * Searches across all knowledge queues since pg-boss v12 requires queue name.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  if (!boss) throw new Error("Job queue not started");

  for (const queue of KNOWLEDGE_QUEUES) {
    const job = await boss.getJobById(queue, jobId);
    if (job) {
      return {
        id: job.id,
        name: job.name,
        state: job.state,
        data: job.data,
        createdOn: job.createdOn,
        startedOn: job.startedOn,
        completedOn: job.completedOn,
        output: job.output,
      };
    }
  }

  return null;
}
