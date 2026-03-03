import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Lightbulb, Pencil, Play, RefreshCw, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import {
  approveExample,
  deleteExample as apiDeleteExample,
  deleteExamplesForPrompt as apiDeleteExamplesForPrompt,
  getActiveJobForPrompt,
  getExample,
  getJobDetails,
  getJobStatus,
  improvePrompt as apiImprovePrompt,
  listExamplesForPrompt,
  listPromptsForCategory,
  rejectExample,
  startGenerate,
  startReRender,
  startRetry,
  updateExampleCode,
  updatePromptText,
  type BatchJobSummary,
  type WorkbenchExample,
  type WorkbenchPrompt,
} from "../api/workbench.api";
import { useAuth } from "../hooks/useAuth";
import { useWorkbenchJobProgress } from "../hooks/useWorkbenchJobProgress";
import { TypingIndicator } from "./chat/TypingIndicator";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CodeBlock } from "./ui/code-block";
import { Dialog } from "./ui/dialog";
import { useToast } from "./ui/toast";
import { InlineModelViewer } from "./chat/InlineModelViewer";

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
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src, token]);

  if (!blobUrl) return <div className={className} />;
  return <img src={blobUrl} className={className} alt="" />;
}

function approvalTone(status: string): "success" | "info" | "warning" | "danger" | "neutral" {
  if (status === "auto_approved") return "success";
  if (status === "human_approved") return "info";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function WorkbenchPromptPage() {
  const { categoryId, promptId } = useParams<{ categoryId: string; promptId: string }>();
  const { token } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [prompt, setPrompt] = useState<WorkbenchPrompt | null>(null);
  const [examples, setExamples] = useState<WorkbenchExample[]>([]);
  const [selectedExample, setSelectedExample] = useState<WorkbenchExample | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<BatchJobSummary | null>(null);
  const [editingCode, setEditingCode] = useState(false);
  const [codeEditValue, setCodeEditValue] = useState("");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptEditValue, setPromptEditValue] = useState("");
  const [confirmDeleteExampleId, setConfirmDeleteExampleId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [improveDialogOpen, setImproveDialogOpen] = useState(false);
  const [improveVariations, setImproveVariations] = useState<string[]>([]);
  const [improveBusy, setImproveBusy] = useState(false);
  const promptSectionRef = useRef<HTMLDivElement>(null);

  // Real-time progress from SSE events during generation
  const { queryState: jobProgressState, detail: jobProgressDetail } = useWorkbenchJobProgress(
    activeJob?.status === "running" ? activeJob.jobId : null,
  );

  // Derive busy from either an active generation job or a quick action in progress
  const busy = actionBusy || (activeJob?.status === "running");

  const loadData = useCallback(async (silent = false) => {
    if (!token || !categoryId || !promptId) return;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const fetches: [Promise<WorkbenchPrompt[]>, Promise<WorkbenchExample[]>, Promise<BatchJobSummary | null>?] = [
        listPromptsForCategory(token, categoryId),
        listExamplesForPrompt(token, promptId),
      ];
      // On initial load, check if there's already a running job for this prompt
      if (!silent) {
        fetches.push(getActiveJobForPrompt(token, promptId));
      }
      const [promptList, exampleList, runningJob] = await Promise.all(fetches);
      const p = promptList.find((pp) => pp.id === promptId) ?? null;
      setPrompt(p);
      setExamples(exampleList);
      // Auto-select the first (most recent) example
      if (!silent) {
        setSelectedExample(exampleList.length > 0 ? exampleList[0] : null);
      }
      // Reconnect to a running job (e.g. started from category page or batch)
      if (!silent && runningJob && runningJob.status === "running") {
        setActiveJob(runningJob);
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [categoryId, promptId, token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Poll active job status
  useEffect(() => {
    if (!activeJob || !token || activeJob.status !== "running") return;

    const interval = setInterval(async () => {
      try {
        const status = await getJobStatus(token, activeJob.jobId);
        setActiveJob(status);

        if (status.status !== "running") {
          // Job finished — fetch result and update UI
          if (status.status === "completed" || status.status === "failed") {
            try {
              const details = await getJobDetails(token, status.jobId);
              const result = details.results[0];
              if (result && result.exampleId) {
                const example = await getExample(token, result.exampleId);
                setExamples((prev) => [example, ...prev]);
                setSelectedExample(example);
                pushToast({
                  tone: result.approvalStatus === "auto_approved" ? "success"
                    : result.status === "error" ? "error"
                    : "info",
                  title: result.status === "error" ? "Generation failed"
                    : result.approvalStatus === "auto_approved" ? "Auto-approved!"
                    : status.type === "re-render" ? "Re-render complete"
                    : status.type === "retry" ? "Retry complete"
                    : "Generation complete",
                  description: result.status === "error"
                    ? result.error ?? "Unknown error"
                    : `Score: ${result.evalScore ?? "N/A"}`,
                });
              } else if (status.error) {
                setError(status.error);
              }
            } catch {
              // Details fetch failed — just refresh
            }
          }
          void loadData(true);
          setActiveJob(null);
        }
      } catch {
        // Ignore polling errors — will retry on next tick
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJob, loadData, pushToast, token]);

  const handleGenerate = useCallback(async () => {
    if (!token || !promptId) return;
    setError(null);
    try {
      const job = await startGenerate(token, promptId);
      setActiveJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [promptId, token]);

  const handleRetry = useCallback(async () => {
    if (!token || !selectedExample) return;
    setError(null);
    try {
      const job = await startRetry(token, selectedExample.id);
      setActiveJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExample, token]);

  const handleApprove = useCallback(async () => {
    if (!token || !selectedExample) return;
    setActionBusy(true);
    setError(null);
    try {
      await approveExample(token, selectedExample.id);
      const updated = await getExample(token, selectedExample.id);
      setSelectedExample(updated);
      setExamples((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      pushToast({ tone: "success", title: "Example approved" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [pushToast, selectedExample, token]);

  const handleReject = useCallback(async () => {
    if (!token || !selectedExample) return;
    setActionBusy(true);
    setError(null);
    try {
      await rejectExample(token, selectedExample.id);
      const updated = await getExample(token, selectedExample.id);
      setSelectedExample(updated);
      setExamples((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      pushToast({ tone: "warning", title: "Example rejected" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [pushToast, selectedExample, token]);

  const handleSaveCode = useCallback(async () => {
    if (!token || !selectedExample) return;
    setActionBusy(true);
    setError(null);
    try {
      await updateExampleCode(token, selectedExample.id, codeEditValue);
      const updated = await getExample(token, selectedExample.id);
      setSelectedExample(updated);
      setExamples((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditingCode(false);
      pushToast({ tone: "info", title: "Code updated", description: "Run 'Retry' to re-render and re-evaluate." });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [codeEditValue, pushToast, selectedExample, token]);

  const handleReRender = useCallback(async () => {
    if (!token || !selectedExample) return;
    setError(null);
    try {
      // If code is being edited, save it first
      if (editingCode) {
        await updateExampleCode(token, selectedExample.id, codeEditValue);
      }
      const job = await startReRender(token, selectedExample.id);
      setActiveJob(job);
      setEditingCode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [codeEditValue, editingCode, selectedExample, token]);

  const handleSavePrompt = useCallback(async () => {
    if (!token || !promptId) return;
    setActionBusy(true);
    setError(null);
    try {
      await updatePromptText(token, promptId, promptEditValue);
      setEditingPrompt(false);
      pushToast({ tone: "success", title: "Prompt updated" });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [loadData, promptEditValue, promptId, pushToast, token]);

  const handleImprovePrompt = useCallback(async () => {
    if (!token || !promptId) return;
    setImproveBusy(true);
    setError(null);
    try {
      const result = await apiImprovePrompt(token, promptId);
      setImproveVariations(result.variations);
      setImproveDialogOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImproveBusy(false);
    }
  }, [promptId, token]);

  const handleSelectVariation = useCallback((index: number) => {
    if (improveVariations.length === 0) return;
    setPromptEditValue(improveVariations[index]);
    setEditingPrompt(true);
    setImproveDialogOpen(false);
    setImproveVariations([]);
    // Scroll to the very top of the page so the user sees the prompt editor
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);
  }, [improveVariations]);

  const handleDeleteExample = useCallback(async (exampleId: string) => {
    if (!token) return;
    setActionBusy(true);
    setError(null);
    try {
      await apiDeleteExample(token, exampleId);
      setConfirmDeleteExampleId(null);
      pushToast({ tone: "warning", title: "Example deleted" });
      // If the deleted example was selected, clear selection
      if (selectedExample?.id === exampleId) {
        setSelectedExample(null);
      }
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [loadData, pushToast, selectedExample, token]);

  const handleDeleteAllExamples = useCallback(async () => {
    if (!token || !promptId) return;
    setActionBusy(true);
    setError(null);
    try {
      const result = await apiDeleteExamplesForPrompt(token, promptId);
      setConfirmDeleteAll(false);
      setSelectedExample(null);
      pushToast({ tone: "warning", title: "All examples deleted", description: `${result.deleted} examples removed` });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [loadData, promptId, pushToast, token]);

  return (
    <section className="space-y-4">
      <PageHeader
        title={`Prompt #${prompt?.index ?? "..."}`}
        breadcrumbs={["Admin", "Workbench", selectedExample?.categoryName ?? "Category", `Prompt ${prompt?.index ?? ""}`]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" iconLeft={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button size="sm" iconLeft={<Play className="h-3.5 w-3.5" />} loading={activeJob?.status === "running"} disabled={busy} onClick={() => void handleGenerate()}>
              Generate
            </Button>
            {examples.length > 0 ? (
              <Button
                size="sm"
                variant="destructive"
                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                disabled={busy}
                onClick={() => setConfirmDeleteAll(true)}
              >
                Delete All
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Editable prompt text */}
      <div ref={promptSectionRef}>
      <SectionCard
        title="Prompt"
        actions={
          editingPrompt ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" iconLeft={<X className="h-3 w-3" />} onClick={() => setEditingPrompt(false)}>
                Cancel
              </Button>
              <Button size="sm" iconLeft={<Check className="h-3 w-3" />} loading={busy} onClick={() => void handleSavePrompt()}>
                Save
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              iconLeft={<Pencil className="h-3 w-3" />}
              onClick={() => { setPromptEditValue(prompt?.prompt ?? ""); setEditingPrompt(true); }}
            >
              Edit
            </Button>
          )
        }
      >
        {editingPrompt ? (
          <textarea
            className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm"
            rows={3}
            value={promptEditValue}
            onChange={(e) => setPromptEditValue(e.target.value)}
          />
        ) : (
          <p className="text-sm">{prompt?.prompt ?? "..."}</p>
        )}
      </SectionCard>
      </div>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {isLoading ? <InlineAlert tone="info">Loading...</InlineAlert> : null}

      {activeJob?.status === "running" ? (
        <TypingIndicator
          queryState={jobProgressState ?? "queued"}
          detail={jobProgressDetail ?? (
            activeJob.type === "batch" ? "Batch processing this prompt..." :
            activeJob.type === "re-render" ? "Re-rendering..." :
            activeJob.type === "retry" ? "Retrying generation..." :
            "Starting..."
          )}
        />
      ) : null}

      {/* Example history */}
      {examples.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex, i) => (
            <div key={ex.id} className="flex items-center gap-0.5">
              <Button
                size="sm"
                variant={selectedExample?.id === ex.id ? "default" : "outline"}
                onClick={() => setSelectedExample(ex)}
              >
                #{i + 1} — Score: {ex.evalScore ?? "?"} <Badge tone={approvalTone(ex.approvalStatus)} className="ml-1">{ex.approvalStatus.replace("_", " ")}</Badge>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                disabled={busy}
                onClick={() => setConfirmDeleteExampleId(ex.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Selected example detail */}
      {selectedExample ? (
        <div className="space-y-4">
          {/* Screenshots */}
          {(selectedExample.screenshotFront || selectedExample.screenshotTop || selectedExample.screenshotIso || selectedExample.stlPath || selectedExample.threemfPath) ? (
            <SectionCard title="Model Views" description="Orthographic views from all 6 faces, 45° up/down overviews, isometric thumbnail, and interactive 3D viewer">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {selectedExample.screenshotFront ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Front</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/front`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotBack ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Back</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/back`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotLeft ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Left</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/left`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotRight ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Right</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/right`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotTop ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Top</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/top`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotBottom ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Bottom</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/bottom`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotOrtho45 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">45° Down</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/ortho_45`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotOrtho45Bottom ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">45° Up</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/ortho_45_bottom`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotIso ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Isometric</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/iso`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotIsoBack ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Iso Back</p>
                    <AuthImage
                      src={`/api/admin/workbench/examples/${selectedExample.id}/screenshot/iso_back`}
                      token={token}
                      className="aspect-square w-full rounded border border-[hsl(var(--border))] object-contain"
                    />
                  </div>
                ) : null}
                {(selectedExample.stlPath || selectedExample.threemfPath) ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">3D Viewer</p>
                    <div className="aspect-square w-full overflow-hidden rounded border border-[hsl(var(--border))]">
                      <InlineModelViewer
                        token={token}
                        filePath={(selectedExample.stlPath ?? selectedExample.threemfPath)!}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          {/* Evaluation */}
          <SectionCard
            title="Evaluation"
            description={`VLM: ${selectedExample.vlmModel ?? "N/A"} | LLM: ${selectedExample.llmModel ?? "N/A"}`}
            actions={
              <div className="flex gap-2">
                {(() => {
                  const isAutoApproved = selectedExample.approvalStatus === "auto_approved";
                  const isHumanApproved = selectedExample.approvalStatus === "human_approved";
                  const isApproved = isAutoApproved || isHumanApproved;
                  const isRejected = selectedExample.approvalStatus === "rejected";
                  return (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={isApproved
                          ? "border border-emerald-700 bg-emerald-900/50 text-emerald-300 hover:bg-emerald-900/70"
                          : "border border-emerald-800 text-emerald-400 hover:bg-emerald-900/30 hover:text-emerald-300"
                        }
                        iconLeft={<ThumbsUp className="h-3 w-3" />}
                        loading={busy}
                        disabled={isHumanApproved}
                        onClick={() => void handleApprove()}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={isRejected
                          ? "border border-red-700 bg-red-900/50 text-red-300 hover:bg-red-900/70"
                          : "border border-red-800 text-red-300 hover:bg-red-900/30 hover:text-red-200"
                        }
                        iconLeft={<ThumbsDown className="h-3 w-3" />}
                        loading={busy}
                        disabled={isRejected}
                        onClick={() => void handleReject()}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                        iconLeft={<RefreshCw className="h-3 w-3" />}
                        loading={busy}
                        onClick={() => void handleRetry()}
                      >
                        Retry
                      </Button>
                      {selectedExample.evalScore != null ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="border border-amber-200 text-amber-500 hover:bg-amber-50 hover:text-amber-700"
                          iconLeft={<Lightbulb className="h-3 w-3" />}
                          loading={improveBusy}
                          disabled={busy}
                          onClick={() => void handleImprovePrompt()}
                        >
                          Improve Prompt
                        </Button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            }
          >
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold">{selectedExample.evalScore ?? "?"}</span>
                <span className="text-sm text-[hsl(var(--muted-foreground))]">/ 10</span>
                <Badge tone={approvalTone(selectedExample.approvalStatus)}>
                  {selectedExample.approvalStatus.replace("_", " ")}
                </Badge>
              </div>

              {selectedExample.renderError ? (
                <InlineAlert tone="danger">Render error: {selectedExample.renderError}</InlineAlert>
              ) : null}

              {selectedExample.evalIssues.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">Issues</p>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {selectedExample.evalIssues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedExample.evalSuggestions.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">Suggestions</p>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {selectedExample.evalSuggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                <span>Iteration: {selectedExample.iteration}</span>
                {selectedExample.promptTokens ? <span>Prompt tokens: {selectedExample.promptTokens}</span> : null}
                {selectedExample.completionTokens ? <span>Completion tokens: {selectedExample.completionTokens}</span> : null}
              </div>
            </div>
          </SectionCard>

          {/* Code */}
          <SectionCard
            title="Generated Code"
            actions={
              editingCode ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" iconLeft={<X className="h-3 w-3" />} onClick={() => setEditingCode(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" iconLeft={<Check className="h-3 w-3" />} loading={busy} onClick={() => void handleSaveCode()}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" iconLeft={<RefreshCw className="h-3 w-3" />} loading={busy} onClick={() => void handleReRender()}>
                    Save &amp; Re-Render
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" iconLeft={<RefreshCw className="h-3 w-3" />} loading={busy} onClick={() => void handleReRender()}>
                    Re-Render
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setCodeEditValue(selectedExample.code); setEditingCode(true); }}>
                    Edit
                  </Button>
                </div>
              )
            }
          >
            {editingCode ? (
              <textarea
                className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 font-mono text-sm"
                rows={20}
                value={codeEditValue}
                onChange={(e) => setCodeEditValue(e.target.value)}
              />
            ) : (
              <CodeBlock language="python">{selectedExample.code}</CodeBlock>
            )}
          </SectionCard>
        </div>
      ) : !isLoading ? (
        <SectionCard title="No examples yet" description="Click 'Generate' to create the first example for this prompt.">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            The generation pipeline will create Build123d code, render it, take screenshots, and evaluate the result with a VLM.
          </p>
        </SectionCard>
      ) : null}

      {/* Delete single example confirmation */}
      <Dialog
        open={confirmDeleteExampleId !== null}
        title="Delete example"
        description="This cannot be undone."
        onClose={() => setConfirmDeleteExampleId(null)}
      >
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirmDeleteExampleId(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            loading={busy}
            onClick={() => confirmDeleteExampleId && void handleDeleteExample(confirmDeleteExampleId)}
          >
            Delete
          </Button>
        </div>
      </Dialog>

      {/* Delete all examples confirmation */}
      <Dialog
        open={confirmDeleteAll}
        title="Delete all examples"
        description={`Delete all ${examples.length} examples for this prompt? This cannot be undone.`}
        onClose={() => setConfirmDeleteAll(false)}
      >
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirmDeleteAll(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            loading={busy}
            onClick={() => void handleDeleteAllExamples()}
          >
            Delete All
          </Button>
        </div>
      </Dialog>

      {/* Prompt improvement variation picker */}
      <Dialog
        open={improveDialogOpen}
        title="Improve Prompt"
        description="Select a variation to use as a starting point. You can edit it before saving."
        onClose={() => setImproveDialogOpen(false)}
      >
        <div className="space-y-3">
          {improveVariations.map((variation, i) => (
            <button
              key={i}
              type="button"
              className="w-full rounded-lg border border-[hsl(var(--border))] p-3 text-left text-sm transition-colors hover:border-[hsl(var(--primary)/0.5)] hover:bg-[hsl(var(--muted)/0.5)]"
              onClick={() => handleSelectVariation(i)}
            >
              <span className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Variation {i + 1}
              </span>
              {variation}
            </button>
          ))}
        </div>
      </Dialog>
    </section>
  );
}
