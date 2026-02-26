import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Database, Download, FolderOpen, Loader2, RefreshCw, Sprout, Trash2, Upload } from "lucide-react";
import {
  backfillEmbeddings,
  deleteTransferJob,
  getEmbeddingStatus,
  getExportStats,
  getRunningJobs,
  getTransferJob,
  listCategories,
  listTransferJobs,
  seedCategories,
  startFullExport,
  uploadAndImport,
  type BatchJobSummary,
  type EmbeddingStatus,
  type ExportStats,
  type SeedResult,
  type TransferJob,
  type WorkbenchCategory,
} from "../api/workbench.api";
import { useAuth } from "../hooks/useAuth";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

function approvedCount(cat: WorkbenchCategory): number {
  return cat.autoApprovedCount + cat.humanApprovedCount;
}

function progressPercent(cat: WorkbenchCategory): number {
  if (cat.promptCount === 0) return 0;
  return Math.round((approvedCount(cat) / cat.promptCount) * 100);
}

function complexityTone(c: number): "success" | "info" | "warning" | "danger" {
  if (c <= 3) return "success";
  if (c <= 6) return "info";
  if (c <= 8) return "warning";
  return "danger";
}

export function WorkbenchPage() {
  const { token } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<WorkbenchCategory[]>([]);
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [runningJobs, setRunningJobs] = useState<Map<string, BatchJobSummary>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [transferJobs, setTransferJobs] = useState<TransferJob[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const [cats, exportStats, embedStatus, jobs, tJobs] = await Promise.all([
        listCategories(token),
        getExportStats(token),
        getEmbeddingStatus(token),
        getRunningJobs(token),
        listTransferJobs(token),
      ]);
      setCategories(cats);
      setStats(exportStats);
      setEmbeddingStatus(embedStatus);
      setRunningJobs(new Map(jobs.map((j) => [j.categoryId, j])));
      setTransferJobs(tJobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Poll for running job status + category data every 3 seconds
  useEffect(() => {
    if (runningJobs.size === 0 || !token) return;
    const interval = setInterval(async () => {
      try {
        const [jobs, cats, exportStats, embedStatus] = await Promise.all([
          getRunningJobs(token),
          listCategories(token),
          getExportStats(token),
          getEmbeddingStatus(token),
        ]);
        setRunningJobs(new Map(jobs.map((j) => [j.categoryId, j])));
        setCategories(cats);
        setStats(exportStats);
        setEmbeddingStatus(embedStatus);
        // When all jobs finish, show is already up to date from this poll
        if (jobs.length === 0) {
          // Clear running jobs — effect will stop polling
        }
      } catch {
        // Silently ignore poll failures
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [runningJobs.size, token]);

  // Poll for active transfer jobs every 2 seconds
  const hasRunningTransfer = transferJobs.some((j) => j.status === "running");
  useEffect(() => {
    if (!hasRunningTransfer || !token) return;
    const interval = setInterval(async () => {
      try {
        const tJobs = await listTransferJobs(token);
        setTransferJobs(tJobs);
        // If a transfer just completed, refresh everything
        const wasRunning = hasRunningTransfer;
        const nowRunning = tJobs.some((j) => j.status === "running");
        if (wasRunning && !nowRunning) {
          const [cats, exportStats, embedStatus] = await Promise.all([
            listCategories(token),
            getExportStats(token),
            getEmbeddingStatus(token),
          ]);
          setCategories(cats);
          setStats(exportStats);
          setEmbeddingStatus(embedStatus);
        }
      } catch {
        // Silently ignore poll failures
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [hasRunningTransfer, token]);

  const handleExportFull = useCallback(async () => {
    if (!token) return;
    setExporting(true);
    setError(null);
    try {
      const job = await startFullExport(token);
      setTransferJobs((prev) => [job, ...prev]);
      pushToast({ tone: "info", title: "Export started", description: "Background export running…" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [pushToast, token]);

  const handleImportClick = useCallback(() => {
    importFileRef.current?.click();
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    // Reset file input so the same file can be re-selected
    e.target.value = "";

    if (!window.confirm(
      "⚠️ This will REPLACE ALL existing workbench data (categories, prompts, examples, system prompts). This action cannot be undone.\n\nContinue?",
    )) {
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const job = await uploadAndImport(token, file);
      setTransferJobs((prev) => [job, ...prev]);
      pushToast({ tone: "info", title: "Import started", description: "Background import running…" });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setImporting(false);
    }
  }, [pushToast, token]);

  const handleDownloadExport = useCallback(async (jobId: string) => {
    if (!token) return;
    try {
      const url = `/api/admin/workbench/transfer-jobs/${encodeURIComponent(jobId)}/download`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `workbench-export.json`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      pushToast({ tone: "success", title: "Export downloaded" });
    } catch (e3) {
      setError(e3 instanceof Error ? e3.message : String(e3));
    }
  }, [pushToast, token]);

  const handleDeleteJob = useCallback(async (jobId: string) => {
    if (!token) return;
    try {
      await deleteTransferJob(token, jobId);
      setTransferJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  const handleSeed = useCallback(async () => {
    if (!token) return;
    setSeeding(true);
    setError(null);
    try {
      const result: SeedResult = await seedCategories(token);
      pushToast({
        tone: "success",
        title: "Seeding complete",
        description: `${result.categories} categories, ${result.prompts} prompts${result.systemPromptSeeded ? ", system prompt v1" : ""}.`,
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }, [loadData, pushToast, token]);

  const handleBackfill = useCallback(async () => {
    if (!token) return;
    setBackfilling(true);
    setError(null);
    try {
      const result = await backfillEmbeddings(token);
      pushToast({
        tone: "success",
        title: "Embedding backfill complete",
        description: `${result.embedded} prompts embedded.`,
      });
      // Refresh embedding status
      const embedStatus = await getEmbeddingStatus(token);
      setEmbeddingStatus(embedStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfilling(false);
    }
  }, [pushToast, token]);

  const handleExportJsonl = useCallback(() => {
    if (!token) return;
    // Download via hidden link with auth header
    const url = `/api/admin/workbench/export/jsonl`;
    const link = document.createElement("a");
    // We can't easily add auth headers to a download link,
    // so we fetch the content and create a blob
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Export failed");
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        link.href = blobUrl;
        link.download = "training-data.jsonl";
        link.click();
        URL.revokeObjectURL(blobUrl);
        pushToast({ tone: "success", title: "Export downloaded" });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [pushToast, token]);

  const totals = stats?.totals;

  return (
    <section className="space-y-4">
      <PageHeader
        title="Build123d LLM Workbench"
        description="Generate, evaluate, and curate training data for fine-tuning a Build123d code generation model."
        breadcrumbs={["Admin", "Workbench"]}
        actions={
          <>
            <Button variant="outline" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} loading={isLoading} onClick={() => void loadData()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" iconLeft={<Sprout className="h-3.5 w-3.5" />} loading={seeding} onClick={() => void handleSeed()}>
              Seed from files
            </Button>
            <Button variant="outline" size="sm" iconLeft={<Database className="h-3.5 w-3.5" />} loading={backfilling} onClick={() => void handleBackfill()} disabled={!embeddingStatus || (embeddingStatus.missing === 0 && embeddingStatus.stale === 0)}>
              Backfill Embeddings{embeddingStatus && (embeddingStatus.missing + embeddingStatus.stale) > 0 ? ` (${embeddingStatus.missing + embeddingStatus.stale})` : ""}
            </Button>
            <Button variant="outline" size="sm" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={handleExportJsonl} disabled={!totals || totals.autoApproved + totals.humanApproved === 0}>
              Export JSONL
            </Button>
            <Button variant="outline" size="sm" iconLeft={<Download className="h-3.5 w-3.5" />} loading={exporting} onClick={() => void handleExportFull()}>
              Export Full
            </Button>
            <Button variant="outline" size="sm" iconLeft={<Upload className="h-3.5 w-3.5" />} loading={importing} onClick={handleImportClick}>
              Import Full
            </Button>
          </>
        }
      />

      {/* Hidden file input for import */}
      <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={(e) => void handleImportFile(e)} />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {/* Transfer job status */}
      {transferJobs.length > 0 ? (
        <div className="space-y-2">
          {transferJobs.map((tj) => (
            <TransferJobCard key={tj.jobId} job={tj} onDownload={handleDownloadExport} onRefresh={() => void loadData()} onDelete={handleDeleteJob} />
          ))}
        </div>
      ) : null}

      {totals ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Auto-approved" value={totals.autoApproved} tone="success" />
          <StatCard label="Human-approved" value={totals.humanApproved} tone="info" />
          <StatCard label="Pending" value={totals.pending} tone="warning" />
          <StatCard label="Rejected" value={totals.rejected} tone="danger" />
        </div>
      ) : null}

      {embeddingStatus ? (
        <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-4 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Database className="h-3.5 w-3.5 shrink-0" />
          <span>
            Embeddings: <strong>{embeddingStatus.embedded}</strong> / {embeddingStatus.total} ({embeddingStatus.currentModel})
          </span>
          {embeddingStatus.missing > 0 ? (
            <Badge tone="warning">{embeddingStatus.missing} missing</Badge>
          ) : null}
          {embeddingStatus.stale > 0 ? (
            <Badge tone="danger">{embeddingStatus.stale} stale</Badge>
          ) : null}
          {embeddingStatus.missing === 0 && embeddingStatus.stale === 0 ? (
            <Badge tone="success">up to date</Badge>
          ) : null}
        </div>
      ) : null}

      {categories.length === 0 && !isLoading ? (
        <SectionCard title="No categories" description="Run 'Seed from files' to populate categories and prompts from the workbench directory.">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Place category Markdown files in <code>workbench/categories/</code> and click the seed button.
          </p>
        </SectionCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => {
            const runningJob = runningJobs.get(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 text-left transition hover:border-[hsl(var(--primary)_/_0.5)] hover:shadow-md"
                onClick={() => navigate(`/workbench/${cat.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {runningJob ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[hsl(var(--primary))]" />
                    ) : (
                      <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    )}
                    <h3 className="font-medium text-[hsl(var(--foreground))]">{cat.name}</h3>
                  </div>
                  <Badge tone={complexityTone(cat.complexity)}>L{cat.complexity}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">{cat.description}</p>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{approvedCount(cat)} / {cat.promptCount} approved</span>
                    <div className="flex items-center gap-2">
                      {cat.avgRating !== null ? (
                        <span className="font-medium" title="Average eval score">⌀ {cat.avgRating.toFixed(1)}</span>
                      ) : null}
                      <span>{progressPercent(cat)}%</span>
                    </div>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div
                      className="h-full rounded-full bg-[hsl(var(--success))]"
                      style={{ width: `${progressPercent(cat)}%` }}
                    />
                  </div>
                </div>
                {runningJob ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>
                      {runningJob.type === "batch"
                        ? `Batch: ${runningJob.completed + runningJob.failed} / ${runningJob.total}`
                        : runningJob.type === "batch-re-render"
                        ? `Re-rendering: ${runningJob.completed + runningJob.failed} / ${runningJob.total}`
                        : runningJob.type === "re-render"
                        ? "Re-rendering..."
                        : "Generating..."}
                    </span>
                    {(runningJob.type === "batch" || runningJob.type === "batch-re-render") && runningJob.failed > 0 ? (
                      <Badge tone="danger">{runningJob.failed} failed</Badge>
                    ) : null}
                  </div>
                ) : cat.pendingCount > 0 ? (
                  <div className="mt-2 flex gap-1.5">
                    <Badge tone="warning">{cat.pendingCount} pending</Badge>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "success" | "info" | "warning" | "danger" }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        <Badge tone={tone} className="text-lg">{value}</Badge>
      </p>
    </div>
  );
}

function TransferJobCard({
  job,
  onDownload,
  onRefresh,
  onDelete,
}: {
  job: TransferJob;
  onDownload: (jobId: string) => void;
  onRefresh: () => void;
  onDelete: (jobId: string) => void;
}) {
  const isExport = job.type === "export";
  const label = isExport ? "Export" : "Import";
  const isDone = job.status === "completed" || job.status === "failed";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-4 py-2.5 text-sm">
      {job.status === "running" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[hsl(var(--primary))]" />
      ) : job.status === "completed" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--danger))]" />
      )}

      <div className="flex-1 min-w-0">
        <span className="font-medium">{label}</span>
        {job.status === "running" ? (
          <span className="ml-2 text-[hsl(var(--muted-foreground))]">
            {job.progress.phase}
            {job.progress.detail ? ` — ${job.progress.detail}` : ""}
          </span>
        ) : job.status === "completed" && job.counts ? (
          <span className="ml-2 text-[hsl(var(--muted-foreground))]">
            {job.counts.categories} categories, {job.counts.prompts} prompts, {job.counts.examples} examples, {job.counts.systemPrompts} system prompts
          </span>
        ) : job.status === "failed" ? (
          <span className="ml-2 text-[hsl(var(--danger))]">{job.error}</span>
        ) : null}
      </div>

      {job.status === "completed" && isExport ? (
        <Button variant="outline" size="sm" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={() => onDownload(job.jobId)}>
          Download
        </Button>
      ) : null}

      {job.status === "completed" && !isExport ? (
        <Button variant="outline" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRefresh}>
          Refresh
        </Button>
      ) : null}

      <Badge tone={job.status === "running" ? "info" : job.status === "completed" ? "success" : "danger"}>
        {job.status}
      </Badge>

      {isDone ? (
        <Button variant="ghost" size="sm" iconLeft={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(job.jobId)} title="Remove from list" />
      ) : null}
    </div>
  );
}
