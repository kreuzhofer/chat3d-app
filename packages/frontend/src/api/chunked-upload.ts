/**
 * Chunked Upload Client
 *
 * Splits a file into chunks, uploads them sequentially with retry,
 * then triggers import on the backend.
 */

const WORKBENCH_API_BASE = "/api/admin/workbench";

export interface ChunkedUploadProgress {
  phase: "init" | "uploading" | "assembling" | "done" | "error";
  uploadedChunks: number;
  totalChunks: number;
  percent: number;
  error?: string;
}

export interface TransferJob {
  jobId: string;
  type: "export" | "import";
  status: "running" | "completed" | "failed";
  progress: { phase: string; detail?: string };
  counts: { categories: number; prompts: number; examples: number; systemPrompts: number } | null;
  filePath: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

interface StatusResponse {
  uploadId: string;
  uploadedChunks: number[];
  totalChunks: number;
  assembled: boolean;
}

const MAX_RETRIES = 3;

function backoffMs(attempt: number): number {
  return 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a file in chunks and start the import.
 * Returns the TransferJob from the backend.
 */
export async function chunkedUploadAndImport({
  token,
  file,
  onProgress,
}: {
  token: string;
  file: File;
  onProgress?: (progress: ChunkedUploadProgress) => void;
}): Promise<TransferJob> {
  const report = (p: Partial<ChunkedUploadProgress> & Pick<ChunkedUploadProgress, "phase">) => {
    onProgress?.({
      uploadedChunks: 0,
      totalChunks: 0,
      percent: 0,
      ...p,
    });
  };

  // 1. Init upload session
  report({ phase: "init" });

  const initRes = await fetch(`${WORKBENCH_API_BASE}/import/upload/init`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
    }),
  });

  if (!initRes.ok) {
    const body = await initRes.json().catch(() => ({}));
    throw new Error(body?.error ?? "Failed to initialize upload");
  }

  const { uploadId, chunkSize, totalChunks } = (await initRes.json()) as InitResponse;

  // 2. Check for any already-uploaded chunks (resume support)
  const statusRes = await fetch(
    `${WORKBENCH_API_BASE}/import/upload/${encodeURIComponent(uploadId)}/status`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  let uploadedSet = new Set<number>();
  if (statusRes.ok) {
    const status = (await statusRes.json()) as StatusResponse;
    uploadedSet = new Set(status.uploadedChunks);
  }

  // 3. Upload chunks sequentially
  let uploadedCount = uploadedSet.size;
  report({
    phase: "uploading",
    uploadedChunks: uploadedCount,
    totalChunks,
    percent: Math.round((uploadedCount / totalChunks) * 100),
  });

  for (let i = 0; i < totalChunks; i++) {
    if (uploadedSet.has(i)) continue; // Already uploaded (resume)

    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const chunkBuffer = await chunk.arrayBuffer();

    let success = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(
          `${WORKBENCH_API_BASE}/import/upload/${encodeURIComponent(uploadId)}/chunk/${i}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/octet-stream",
            },
            body: chunkBuffer,
          },
        );

        if (res.ok) {
          success = true;
          break;
        }

        // Non-retryable errors (4xx except 408/429)
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Chunk upload failed with status ${res.status}`);
        }

        // Retryable server error
        if (attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs(attempt));
        }
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) throw err;
        await sleep(backoffMs(attempt));
      }
    }

    if (!success) {
      throw new Error(`Failed to upload chunk ${i} after ${MAX_RETRIES} retries`);
    }

    uploadedCount++;
    report({
      phase: "uploading",
      uploadedChunks: uploadedCount,
      totalChunks,
      percent: Math.round((uploadedCount / totalChunks) * 100),
    });
  }

  // 4. Assemble and start import
  report({
    phase: "assembling",
    uploadedChunks: totalChunks,
    totalChunks,
    percent: 100,
  });

  const completeRes = await fetch(
    `${WORKBENCH_API_BASE}/import/upload/${encodeURIComponent(uploadId)}/complete`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!completeRes.ok) {
    const body = await completeRes.json().catch(() => ({}));
    throw new Error(body?.error ?? "Failed to complete upload");
  }

  const job = (await completeRes.json()) as TransferJob;

  report({
    phase: "done",
    uploadedChunks: totalChunks,
    totalChunks,
    percent: 100,
  });

  return job;
}
