const BACKUPS_API_BASE = "/api/admin/backups";

// ── Types ────────────────────────────────────────────────────────────

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

export function formatBackupSize(sizeBytes: string | null): string {
  if (!sizeBytes) return "—";
  const bytes = Number(sizeBytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getBackupDownloadUrl(id: string): string {
  return `${BACKUPS_API_BASE}/${id}/download`;
}

// ── API Functions ────────────────────────────────────────────────────

export async function listBackups(token: string, type?: string): Promise<BackupRecord[]> {
  const params = type ? `?type=${encodeURIComponent(type)}` : "";
  const response = await fetch(`${BACKUPS_API_BASE}${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Failed to list backups");
  }
  return body as BackupRecord[];
}

export async function deleteBackup(token: string, id: string): Promise<void> {
  const response = await fetch(`${BACKUPS_API_BASE}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Failed to delete backup");
  }
}
