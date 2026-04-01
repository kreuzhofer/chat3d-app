import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Database, HardDrive, Upload } from "lucide-react";
import {
  type SystemBackupJob,
  listSystemBackupJobs,
  startSystemExport,
  uploadAndRestore,
} from "../../api/system-backup.api";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../ui/toast";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { SectionCard } from "../layout/SectionCard";

interface Props {
  onBackupCreated: () => void;
}

export function SystemBackupPanel({ onBackupCreated }: Props) {
  const { token } = useAuth();
  const { pushToast } = useToast();

  const [jobs, setJobs] = useState<SystemBackupJob[]>([]);
  const [exporting, setExporting] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreStep, setRestoreStep] = useState<"idle" | "confirm1" | "confirm2">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load jobs on mount
  useEffect(() => {
    if (!token) return;
    void listSystemBackupJobs(token).then(setJobs).catch(() => {});
  }, [token]);

  // Poll while any job is running
  const hasRunning = jobs.some((j) => j.status === "running");
  useEffect(() => {
    if (!hasRunning || !token) return;
    const interval = setInterval(async () => {
      try {
        const updated = await listSystemBackupJobs(token);
        setJobs(updated);
        const wasRunning = hasRunning;
        const nowRunning = updated.some((j) => j.status === "running");
        if (wasRunning && !nowRunning) {
          onBackupCreated();
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [hasRunning, token, onBackupCreated]);

  const runningJob = jobs.find((j) => j.status === "running");

  const handleExport = useCallback(async () => {
    if (!token) return;
    setExporting(true);
    try {
      const job = await startSystemExport(token);
      setJobs((prev) => [job, ...prev]);
      pushToast({ tone: "info", title: "System backup started" });
    } catch (e) {
      pushToast({ tone: "danger", title: String(e) });
    } finally {
      setExporting(false);
    }
  }, [token, pushToast]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setRestoreFile(file);
  }, []);

  const handleRestoreClick = useCallback(() => {
    if (!restoreFile) return;
    setRestoreStep("confirm1");
  }, [restoreFile]);

  const handleConfirm1 = useCallback(() => {
    setRestoreStep("confirm2");
    setConfirmText("");
  }, []);

  const handleConfirm2 = useCallback(async () => {
    if (!token || !restoreFile || confirmText !== "RESTORE") return;
    setRestoring(true);
    setRestoreStep("idle");
    try {
      const job = await uploadAndRestore(token, restoreFile);
      setJobs((prev) => [job, ...prev]);
      setRestoreFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      pushToast({ tone: "info", title: "System restore started" });
    } catch (e) {
      pushToast({ tone: "danger", title: String(e) });
    } finally {
      setRestoring(false);
    }
  }, [token, restoreFile, confirmText, pushToast]);

  const closeDialog = useCallback(() => {
    setRestoreStep("idle");
    setConfirmText("");
  }, []);

  return (
    <>
      {/* Export */}
      <SectionCard
        title="System Backup"
        description="Create a full backup of the database and all stored files (models, screenshots, uploads)."
        actions={
          <Button
            size="sm"
            onClick={() => void handleExport()}
            disabled={exporting || !!runningJob}
          >
            <Database className="mr-1.5 h-3.5 w-3.5" />
            {runningJob?.type === "export" ? "Exporting..." : "Create Backup"}
          </Button>
        }
      >
        {runningJob ? (
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <Spinner size="sm" />
            <span className="capitalize">{runningJob.progress.phase}</span>
            {runningJob.progress.detail ? (
              <span className="text-xs">({runningJob.progress.detail})</span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            The backup includes the full PostgreSQL database and all file storage.
            Download the resulting archive from the backup list below.
          </p>
        )}
      </SectionCard>

      {/* Restore */}
      <SectionCard
        title="Restore from Backup"
        description="Upload a system backup archive to restore the database and files. This is a destructive operation."
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--foreground))]">
              <Upload className="h-4 w-4" />
              {restoreFile ? restoreFile.name : "Choose .tar.gz archive"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar.gz,.tgz"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRestoreClick}
              disabled={!restoreFile || restoring || !!runningJob}
            >
              <HardDrive className="mr-1.5 h-3.5 w-3.5" />
              {restoring ? "Restoring..." : "Restore"}
            </Button>
          </div>

          {restoring && runningJob?.type === "restore" ? (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <Spinner size="sm" />
              <span className="capitalize">{runningJob.progress.phase}</span>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg bg-[hsl(var(--warning)/0.1)] p-3 text-xs text-[hsl(var(--warning-foreground))]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Restoring will <strong>replace all existing data</strong> (database and files).
              A server restart may be needed after restore.
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Confirm dialog 1 */}
      <Dialog
        open={restoreStep === "confirm1"}
        title="Restore System Backup"
        description="This will replace ALL data in the database and file storage. Are you sure?"
        onClose={closeDialog}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeDialog}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm1}>Continue</Button>
        </div>
      </Dialog>

      {/* Confirm dialog 2 — type RESTORE */}
      <Dialog
        open={restoreStep === "confirm2"}
        title="Final Confirmation"
        description={`Type RESTORE to confirm. This cannot be undone.`}
        onClose={closeDialog}
      >
        <div className="space-y-4">
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type RESTORE"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "RESTORE"}
              onClick={() => void handleConfirm2()}
            >
              Restore Now
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
