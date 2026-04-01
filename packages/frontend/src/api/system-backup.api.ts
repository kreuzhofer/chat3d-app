const BASE = "/api/admin/system-backup";

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

// ── Helpers ──────────────────────────────────────────────────────────

async function jsonRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Request failed");
  }
  return body as T;
}

// ── API Functions ────────────────────────────────────────────────────

export function startSystemExport(token: string): Promise<SystemBackupJob> {
  return jsonRequest<SystemBackupJob>(token, "/export", { method: "POST" });
}

export function getSystemBackupJob(token: string, jobId: string): Promise<SystemBackupJob> {
  return jsonRequest<SystemBackupJob>(token, `/jobs/${encodeURIComponent(jobId)}`);
}

export function listSystemBackupJobs(token: string): Promise<SystemBackupJob[]> {
  return jsonRequest<SystemBackupJob[]>(token, "/jobs");
}

export async function uploadAndRestore(token: string, file: File): Promise<SystemBackupJob> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${BASE}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Restore upload failed");
  }
  return body as SystemBackupJob;
}
