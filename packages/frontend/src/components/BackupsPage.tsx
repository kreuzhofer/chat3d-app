import { useCallback, useEffect, useState } from "react";
import { Archive, Download, RefreshCw, Trash2 } from "lucide-react";
import {
  type BackupRecord,
  deleteBackup,
  formatBackupSize,
  getBackupDownloadUrl,
  listBackups,
} from "../api/backups.api";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "./ui/toast";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { EmptyState } from "./layout/EmptyState";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatCounts(counts: Record<string, number> | null): string {
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.categories) parts.push(`${counts.categories} categories`);
  if (counts.prompts) parts.push(`${counts.prompts} prompts`);
  if (counts.examples) parts.push(`${counts.examples} examples`);
  return parts.join(", ");
}

const statusTone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  completed: "success",
  running: "warning",
  failed: "danger",
};

const typeTone: Record<string, "info" | "neutral"> = {
  workbench: "info",
};

export function BackupsPage() {
  const { token } = useAuth();
  const { pushToast } = useToast();

  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBackups = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const data = await listBackups(token);
      setBackups(data);
    } catch (e) {
      pushToast({ title: String(e), tone: "danger" });
    } finally {
      setLoading(false);
    }
  }, [token, pushToast]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleDelete = useCallback(async () => {
    if (!token || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBackup(token, deleteTarget.id);
      pushToast({ title: "Backup deleted", tone: "success" });
      setDeleteTarget(null);
      await loadBackups();
    } catch (e) {
      pushToast({ title: String(e), tone: "danger" });
    } finally {
      setDeleting(false);
    }
  }, [token, deleteTarget, pushToast, loadBackups]);

  const handleDownload = useCallback(
    (backup: BackupRecord) => {
      if (!token) return;
      // Use a hidden link to trigger download with auth header via fetch
      const url = getBackupDownloadUrl(backup.id);
      void (async () => {
        try {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) throw new Error("Download failed");
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = backup.fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(blobUrl);
        } catch (e) {
          pushToast({ title: String(e), tone: "danger" });
        }
      })();
    },
    [token, pushToast],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <PageHeader
        title="Backups"
        breadcrumbs={["Admin", "Backups"]}
        description="Manage exported backup archives. Backups are created when workbench data is exported."
        actions={
          <Button size="sm" variant="outline" onClick={() => void loadBackups()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {!loading && backups.length === 0 ? (
        <EmptyState
          title="No backups yet"
          description="Backups will appear here after you export workbench data from the Workbench page."
        />
      ) : (
        <SectionCard title="All Backups" description={`${backups.length} backup${backups.length !== 1 ? "s" : ""}`}>
          <div className="divide-y divide-[hsl(var(--border))]">
            {backups.map((backup) => (
              <div key={backup.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))]">
                  <Archive className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                </div>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">{backup.label}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{backup.fileName}</span>
                    <span>{formatBackupSize(backup.sizeBytes)}</span>
                    {backup.counts ? <span>{formatCounts(backup.counts)}</span> : null}
                    <span>{formatDate(backup.createdAt)}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={typeTone[backup.type] ?? "neutral"}>{backup.type}</Badge>
                  <Badge tone={statusTone[backup.status] ?? "neutral"}>{backup.status}</Badge>

                  {backup.status === "completed" ? (
                    <Button size="sm" variant="outline" onClick={() => handleDownload(backup)}>
                      <Download className="mr-1 h-3.5 w-3.5" />
                      Download
                    </Button>
                  ) : null}

                  <Button size="sm" variant="outline" className="text-[hsl(var(--destructive))]" onClick={() => setDeleteTarget(backup)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <Dialog
        open={deleteTarget !== null}
        title="Delete Backup"
        description={`Are you sure you want to delete "${deleteTarget?.label}"? This will remove the backup file from disk. This action cannot be undone.`}
        onClose={() => setDeleteTarget(null)}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
