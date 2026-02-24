import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Download, FolderOpen, Loader2, RefreshCw, Sprout } from "lucide-react";
import {
  backfillEmbeddings,
  getEmbeddingStatus,
  getExportStats,
  getRunningJobs,
  listCategories,
  seedCategories,
  type BatchJobSummary,
  type EmbeddingStatus,
  type ExportStats,
  type SeedResult,
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

  const loadData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const [cats, exportStats, embedStatus, jobs] = await Promise.all([
        listCategories(token),
        getExportStats(token),
        getEmbeddingStatus(token),
        getRunningJobs(token),
      ]);
      setCategories(cats);
      setStats(exportStats);
      setEmbeddingStatus(embedStatus);
      setRunningJobs(new Map(jobs.map((j) => [j.categoryId, j])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Poll for running job status every 3 seconds
  useEffect(() => {
    if (runningJobs.size === 0 || !token) return;
    const interval = setInterval(async () => {
      try {
        const jobs = await getRunningJobs(token);
        setRunningJobs(new Map(jobs.map((j) => [j.categoryId, j])));
        // When all jobs finish, refresh full data to update counts
        if (jobs.length === 0) {
          void loadData();
        }
      } catch {
        // Silently ignore poll failures
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [runningJobs.size, token, loadData]);

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
          </>
        }
      />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

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
                    <span>{progressPercent(cat)}%</span>
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
                    <span>Batch: {runningJob.completed + runningJob.failed} / {runningJob.total}</span>
                    {runningJob.failed > 0 ? (
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
