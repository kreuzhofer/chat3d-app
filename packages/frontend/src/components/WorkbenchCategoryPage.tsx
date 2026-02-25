import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Play, Sparkles, Square, Trash2, Zap } from "lucide-react";
import {
  cancelJob,
  deleteExamplesForCategory,
  getJobStatus,
  getRunningJob,
  listCategories,
  listPromptsForCategory,
  startBatchJob,
  startGenerate,
  type BatchJobSummary,
  type WorkbenchCategory,
  type WorkbenchPrompt,
} from "../api/workbench.api";
import { useAuth } from "../hooks/useAuth";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { useToast } from "./ui/toast";

type Filter = "all" | "pending" | "approved" | "no_examples";

/** Tiny component that fetches an image with an Authorization header and displays it as a blob URL. */
function AuthImage({ src, token, className }: { src: string; token: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
      } catch {
        // Silently ignore — placeholder will show
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src, token]);

  if (!blobUrl) return null;
  return <img src={blobUrl} alt="" className={className} />;
}

function approvalTone(status: string | null): "success" | "info" | "warning" | "danger" | "neutral" {
  if (status === "auto_approved") return "success";
  if (status === "human_approved") return "info";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function approvalLabel(status: string | null): string {
  if (status === "auto_approved") return "auto";
  if (status === "human_approved") return "human";
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  return "none";
}

export function WorkbenchCategoryPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { token } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [category, setCategory] = useState<WorkbenchCategory | null>(null);
  const [prompts, setPrompts] = useState<WorkbenchPrompt[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [singleJobs, setSingleJobs] = useState<Map<string, BatchJobSummary>>(new Map());
  const [batchJob, setBatchJob] = useState<BatchJobSummary | null>(null);
  const [confirmResetCategory, setConfirmResetCategory] = useState(false);
  const pendingScrollRestore = useRef(false);

  // Restore scroll position after initial data load renders the list
  const scrollKey = `workbench-scroll-${categoryId}`;
  useEffect(() => {
    if (!pendingScrollRestore.current || prompts.length === 0) return;
    pendingScrollRestore.current = false;
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) {
      // Small delay so the DOM has rendered the prompt rows
      requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
      sessionStorage.removeItem(scrollKey);
    }
  }, [prompts, scrollKey]);

  const saveScrollAndNavigate = useCallback(
    (path: string) => {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
      navigate(path);
    },
    [navigate, scrollKey],
  );

  const loadData = useCallback(async (silent = false) => {
    if (!token || !categoryId) return;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const fetches: [Promise<WorkbenchCategory[]>, Promise<WorkbenchPrompt[]>, Promise<BatchJobSummary | null>?] = [
        listCategories(token),
        listPromptsForCategory(token, categoryId),
      ];
      // On initial load, check if there's already a running batch job for this category
      if (!silent) {
        fetches.push(getRunningJob(token, categoryId));
      }
      const [cats, promptList, runningJob] = await Promise.all(fetches);
      const cat = cats.find((c) => c.id === categoryId) ?? null;
      setCategory(cat);
      setPrompts(promptList);
      // Reconnect to a running batch job (e.g. after page refresh)
      if (!silent && runningJob && runningJob.status === "running") {
        setBatchJob(runningJob);
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [categoryId, token]);

  useEffect(() => {
    // If there's a saved scroll position, flag that we need to restore after data loads
    if (sessionStorage.getItem(scrollKey)) {
      pendingScrollRestore.current = true;
    }
    void loadData();
  }, [loadData, scrollKey]);

  // Poll batch job status
  useEffect(() => {
    if (!batchJob || !token || batchJob.status !== "running") return;

    const interval = setInterval(async () => {
      try {
        const status = await getJobStatus(token, batchJob.jobId);
        setBatchJob(status);
        if (status.status !== "running") {
          // Job finished — final refresh and show toast
          void loadData(true);
          pushToast({
            tone: status.status === "completed" ? "success" : "warning",
            title: `Batch ${status.status}`,
            description: `${status.completed} completed, ${status.failed} failed, ${status.skipped} skipped`,
          });
        } else {
          // Still running — silently refresh prompt list so scores/statuses update live
          void loadData(true);
        }
      } catch {
        // Ignore polling errors — will retry on next tick
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [batchJob, loadData, pushToast, token]);

  // Poll single-prompt jobs
  useEffect(() => {
    if (singleJobs.size === 0 || !token) return;

    const interval = setInterval(async () => {
      const updates = new Map(singleJobs);
      let changed = false;

      for (const [promptId, job] of singleJobs) {
        if (job.status !== "running") continue;
        try {
          const status = await getJobStatus(token, job.jobId);
          if (status.status !== "running") {
            updates.delete(promptId);
            changed = true;
            pushToast({
              tone: status.status === "completed" ? "success" : "warning",
              title: status.status === "completed" ? "Generation complete" : "Generation failed",
              description: status.error ?? undefined,
            });
          } else {
            updates.set(promptId, status);
          }
        } catch {
          // Ignore polling errors
        }
      }

      if (changed) {
        void loadData(true);
      }
      setSingleJobs(updates);
    }, 3000);

    return () => clearInterval(interval);
  }, [singleJobs, loadData, pushToast, token]);

  const handleBatchGenerate = useCallback(
    async (skipApproved: boolean) => {
      if (!token || !categoryId) return;
      setError(null);
      try {
        const job = await startBatchJob(token, categoryId, skipApproved);
        setBatchJob(job);
        pushToast({
          tone: "info",
          title: "Batch started",
          description: `Processing ${job.total} prompts${job.skipped > 0 ? ` (${job.skipped} skipped)` : ""}...`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [categoryId, pushToast, token],
  );

  const handleCancelBatch = useCallback(async () => {
    if (!token || !batchJob) return;
    try {
      await cancelJob(token, batchJob.jobId);
      setBatchJob((prev) => (prev ? { ...prev, status: "cancelled" } : null));
      pushToast({ tone: "warning", title: "Batch cancelled" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [batchJob, pushToast, token]);

  const batchRunning = batchJob?.status === "running";
  const anySingleRunning = singleJobs.size > 0;

  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (filter === "all") return true;
      if (filter === "no_examples") return p.exampleCount === 0;
      if (filter === "pending") return p.bestApproval === "pending" || p.bestApproval === null;
      if (filter === "approved") return p.bestApproval === "auto_approved" || p.bestApproval === "human_approved";
      return true;
    });
  }, [filter, prompts]);

  const handleGenerate = useCallback(
    async (promptId: string) => {
      if (!token) return;
      setError(null);
      try {
        const job = await startGenerate(token, promptId);
        setSingleJobs((prev) => new Map(prev).set(promptId, job));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [token],
  );

  const handleResetCategory = useCallback(async () => {
    if (!token || !categoryId) return;
    setError(null);
    try {
      const result = await deleteExamplesForCategory(token, categoryId);
      setConfirmResetCategory(false);
      pushToast({ tone: "warning", title: "Category reset", description: `${result.deleted} examples deleted` });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [categoryId, loadData, pushToast, token]);

  return (
    <section className="space-y-4">
      <PageHeader
        title={category?.name ?? "Category"}
        description={category?.description}
        breadcrumbs={["Admin", "Workbench", category?.name ?? "..."]}
        actions={
          <>
            <Button variant="outline" size="sm" iconLeft={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate(-1)}>
              Back
            </Button>
            {batchRunning ? (
              <Button
                variant="outline"
                size="sm"
                iconLeft={<Square className="h-3.5 w-3.5" />}
                onClick={() => void handleCancelBatch()}
              >
                Cancel Batch
              </Button>
            ) : (
              <>
                <Button
                  variant="default"
                  size="sm"
                  iconLeft={<Zap className="h-3.5 w-3.5" />}
                  onClick={() => void handleBatchGenerate(true)}
                  disabled={anySingleRunning}
                >
                  Generate All
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                  disabled={anySingleRunning}
                  onClick={() => setConfirmResetCategory(true)}
                >
                  Reset Results
                </Button>
              </>
            )}
          </>
        }
      />

      {category ? (
        <div className="flex items-center gap-4 text-sm text-[hsl(var(--muted-foreground))]">
          <span>{category.autoApprovedCount + category.humanApprovedCount} / {category.promptCount} approved</span>
          {category.avgRating !== null ? (
            <span className="font-medium" title="Average eval score across all examples">Avg rating: {category.avgRating.toFixed(1)}</span>
          ) : null}
          {category.pendingCount > 0 ? (
            <Badge tone="warning">{category.pendingCount} pending</Badge>
          ) : null}
        </div>
      ) : null}

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {batchJob && batchJob.status === "running" ? (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--primary))]" />
            <span className="font-medium">
              Batch: {batchJob.completed + batchJob.failed} / {batchJob.total}
            </span>
            {batchJob.failed > 0 ? (
              <Badge tone="danger">{batchJob.failed} failed</Badge>
            ) : null}
          </div>
          {batchJob.currentPromptText ? (
            <p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
              Current: {batchJob.currentPromptText}
            </p>
          ) : null}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
            <div
              className="h-full rounded-full bg-[hsl(var(--primary))] transition-all"
              style={{ width: `${batchJob.total > 0 ? Math.round(((batchJob.completed + batchJob.failed) / batchJob.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "no_examples", "pending", "approved"] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "no_examples" ? "No examples" : f === "pending" ? "Pending" : "Approved"}
            {f === "all" ? ` (${prompts.length})` : ` (${prompts.filter((p) => {
              if (f === "no_examples") return p.exampleCount === 0;
              if (f === "pending") return p.bestApproval === "pending" || p.bestApproval === null;
              if (f === "approved") return p.bestApproval === "auto_approved" || p.bestApproval === "human_approved";
              return true;
            }).length})`}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <InlineAlert tone="info">Loading prompts...</InlineAlert>
      ) : (
        <div className="space-y-1">
          {filteredPrompts.map((prompt) => {
            const isBatchCurrent = batchRunning && batchJob?.currentPromptId === prompt.id;
            const isSingleRunning = singleJobs.has(prompt.id);
            const isGenerating = isBatchCurrent || isSingleRunning;
            const thumbUrl = prompt.bestExampleId
              ? `/api/admin/workbench/examples/${prompt.bestExampleId}/screenshot/iso`
              : null;
            return (
              <div
                key={prompt.id}
                className={`flex h-16 items-center gap-3 rounded-md border px-3 transition ${isGenerating ? "border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.05)]" : "border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] hover:border-[hsl(var(--primary)_/_0.3)]"}`}
              >
                {/* Thumbnail — fixed width so text column stays aligned */}
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-[hsl(var(--muted)_/_0.3)]">
                  {thumbUrl && token ? (
                    <AuthImage
                      src={thumbUrl}
                      token={token}
                      className="h-full w-full scale-150 object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-[hsl(var(--muted-foreground)_/_0.5)]">—</div>
                  )}
                </div>

                {isGenerating ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[hsl(var(--primary))]" />
                ) : (
                  <span className="w-8 shrink-0 text-right text-xs font-mono text-[hsl(var(--muted-foreground))]">
                    {prompt.index}
                  </span>
                )}

                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm text-[hsl(var(--foreground))] hover:underline"
                  onClick={() => saveScrollAndNavigate(`/workbench/${categoryId}/${prompt.id}`)}
                  title={prompt.prompt}
                >
                  {prompt.prompt}
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  {prompt.bestScore !== null ? (
                    <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">
                      {prompt.bestScore}/10
                    </span>
                  ) : null}

                  <Badge tone={approvalTone(prompt.bestApproval)}>
                    {approvalLabel(prompt.bestApproval)}
                  </Badge>

                  {prompt.exampleCount > 0 ? (
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {prompt.exampleCount}x
                    </span>
                  ) : null}

                  <Button
                    size="sm"
                    variant="outline"
                    iconLeft={isSingleRunning ? <Sparkles className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    loading={isSingleRunning}
                    disabled={isGenerating || batchRunning}
                    onClick={() => void handleGenerate(prompt.id)}
                  >
                    Generate
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reset category confirmation */}
      <Dialog
        open={confirmResetCategory}
        title="Reset all results"
        description={`Delete all generated examples for category "${category?.name ?? ""}"? This removes all examples across all prompts and cannot be undone.`}
        onClose={() => setConfirmResetCategory(false)}
      >
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirmResetCategory(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void handleResetCategory()}
          >
            Delete All Examples
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
