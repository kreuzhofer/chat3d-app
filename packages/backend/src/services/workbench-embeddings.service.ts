/**
 * Workbench Embeddings Service
 *
 * Generates and stores vector embeddings for workbench example prompts.
 * Used for semantic similarity search when selecting few-shot examples
 * for the code generation pipeline.
 */

import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";
import { pool } from "../db/connection.js";

// ── Types ────────────────────────────────────────────────────────────

export interface FewShotMatch {
  prompt: string;
  code: string;
  similarity: number;
}

export interface EmbeddingStatus {
  total: number;
  embedded: number;
  missing: number;
}

export interface BackfillResult {
  embedded: number;
  skipped: number;
}

// ── Provider setup ──────────────────────────────────────────────────

// Target dimension for pgvector index compatibility (max 2000 for HNSW/IVFFlat)
// text-embedding-3-large with dimensions=1536 produces better quality than
// text-embedding-3-small at the same dimension via Matryoshka Representation Learning.
const EMBEDDING_DIMENSIONS = 1536;

function resolveEmbeddingModel() {
  const provider = config.workbench.embeddingProvider;
  const modelName = config.workbench.embeddingModel;

  if (provider === "openai") {
    if (!config.query.openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required for embeddings");
    }
    return createOpenAI({ apiKey: config.query.openAiApiKey }).embedding(modelName, {
      dimensions: EMBEDDING_DIMENSIONS,
    });
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

// ── Core embedding functions ────────────────────────────────────────

/**
 * Embed a single text string into a vector.
 */
export async function embedPromptText(text: string): Promise<number[]> {
  const model = resolveEmbeddingModel();
  const result = await embed({ model, value: text });
  return result.embedding;
}

/**
 * Embed a prompt and store the vector in the database.
 */
export async function embedAndStorePrompt(promptId: string, promptText: string): Promise<void> {
  const embedding = await embedPromptText(promptText);
  const pgVector = `[${embedding.join(",")}]`;
  await pool.query(
    `UPDATE workbench_example_prompts SET embedding = $2::vector WHERE id = $1`,
    [promptId, pgVector],
  );
}

// ── Backfill ────────────────────────────────────────────────────────

/**
 * Batch-embed all prompts that have NULL embeddings.
 * Uses embedMany for efficient batching.
 */
export async function backfillEmbeddings(): Promise<BackfillResult> {
  const result = await pool.query<{ id: string; prompt: string }>(
    `SELECT id, prompt FROM workbench_example_prompts WHERE embedding IS NULL ORDER BY created_at`,
  );

  if (result.rows.length === 0) {
    return { embedded: 0, skipped: 0 };
  }

  const model = resolveEmbeddingModel();
  const BATCH_SIZE = 100;
  let embedded = 0;

  for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
    const batch = result.rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((row) => row.prompt);

    const embedResult = await embedMany({ model, values: texts });

    // Store each embedding in a transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let j = 0; j < batch.length; j++) {
        const pgVector = `[${embedResult.embeddings[j].join(",")}]`;
        await client.query(
          `UPDATE workbench_example_prompts SET embedding = $2::vector WHERE id = $1`,
          [batch[j].id, pgVector],
        );
      }
      await client.query("COMMIT");
      embedded += batch.length;
      console.log(`[embeddings] backfilled ${embedded}/${result.rows.length} prompts`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return { embedded, skipped: 0 };
}

// ── Vector similarity search ────────────────────────────────────────

/**
 * Find the most semantically similar approved examples across ALL categories.
 * Returns examples ordered by cosine similarity (highest first).
 */
export async function findSimilarExamples(
  promptText: string,
  limit = 6,
): Promise<FewShotMatch[]> {
  const queryEmbedding = await embedPromptText(promptText);
  const pgVector = `[${queryEmbedding.join(",")}]`;

  const result = await pool.query<{ prompt: string; code: string; similarity: number }>(
    `SELECT p.prompt, e.code,
            1 - (p.embedding <=> $1::vector) AS similarity
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     WHERE p.embedding IS NOT NULL
       AND e.approval_status IN ('auto_approved', 'human_approved')
     ORDER BY p.embedding <=> $1::vector ASC
     LIMIT $2`,
    [pgVector, limit],
  );

  return result.rows;
}

// ── Status ──────────────────────────────────────────────────────────

/**
 * Return counts of total, embedded, and missing embeddings.
 */
export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const result = await pool.query<{ total: string; embedded: string }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(embedding)::text AS embedded
    FROM workbench_example_prompts
  `);
  const row = result.rows[0];
  const total = Number(row.total);
  const embeddedCount = Number(row.embedded);
  return {
    total,
    embedded: embeddedCount,
    missing: total - embeddedCount,
  };
}
