import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Play, RefreshCw, ThumbsDown, X } from "lucide-react";
import {
  approveExample,
  generateForPrompt,
  getExample,
  listPromptsForCategory,
  rejectExample,
  retryExample,
  updateExampleCode,
  type GenerateResult,
  type WorkbenchExample,
  type WorkbenchPrompt,
} from "../api/workbench.api";
import { useAuth } from "../hooks/useAuth";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CodeBlock } from "./ui/code-block";
import { useToast } from "./ui/toast";

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
  const [busy, setBusy] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [codeEditValue, setCodeEditValue] = useState("");

  const loadData = useCallback(async () => {
    if (!token || !categoryId || !promptId) return;
    setIsLoading(true);
    setError(null);
    try {
      const promptList = await listPromptsForCategory(token, categoryId);
      const p = promptList.find((pp) => pp.id === promptId) ?? null;
      setPrompt(p);

      // Load examples for this prompt — we don't have a direct endpoint,
      // but the prompt has exampleCount. For now, we rely on the single
      // generate/retry flow. If there are examples, we need the generate
      // result which returns an exampleId.
      // For a full implementation, we'd need a GET /prompts/:id/examples endpoint.
      // For now, clear examples on load.
      setExamples([]);
      setSelectedExample(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, promptId, token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerate = useCallback(async () => {
    if (!token || !promptId) return;
    setBusy(true);
    setError(null);
    try {
      const result: GenerateResult = await generateForPrompt(token, promptId);
      pushToast({
        tone: result.approvalStatus === "auto_approved" ? "success" : "info",
        title: result.approvalStatus === "auto_approved" ? "Auto-approved!" : "Generation complete",
        description: `Score: ${result.evalScore ?? "N/A"}, iteration: ${result.iteration}`,
      });
      // Load the full example
      const example = await getExample(token, result.exampleId);
      setExamples((prev) => [example, ...prev]);
      setSelectedExample(example);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadData, promptId, pushToast, token]);

  const handleRetry = useCallback(async () => {
    if (!token || !selectedExample) return;
    setBusy(true);
    setError(null);
    try {
      const result = await retryExample(token, selectedExample.id);
      const example = await getExample(token, result.exampleId);
      setExamples((prev) => [example, ...prev]);
      setSelectedExample(example);
      pushToast({
        tone: result.approvalStatus === "auto_approved" ? "success" : "info",
        title: "Retry complete",
        description: `Score: ${result.evalScore ?? "N/A"}`,
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadData, pushToast, selectedExample, token]);

  const handleApprove = useCallback(async () => {
    if (!token || !selectedExample) return;
    setBusy(true);
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
      setBusy(false);
    }
  }, [pushToast, selectedExample, token]);

  const handleReject = useCallback(async () => {
    if (!token || !selectedExample) return;
    setBusy(true);
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
      setBusy(false);
    }
  }, [pushToast, selectedExample, token]);

  const handleSaveCode = useCallback(async () => {
    if (!token || !selectedExample) return;
    setBusy(true);
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
      setBusy(false);
    }
  }, [codeEditValue, pushToast, selectedExample, token]);

  return (
    <section className="space-y-4">
      <PageHeader
        title={`Prompt #${prompt?.index ?? "..."}`}
        description={prompt?.prompt}
        breadcrumbs={["Admin", "Workbench", selectedExample?.categoryName ?? "Category", `Prompt ${prompt?.index ?? ""}`]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" iconLeft={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate(`/workbench/${categoryId}`)}>
              Back
            </Button>
            <Button size="sm" iconLeft={<Play className="h-3.5 w-3.5" />} loading={busy} onClick={() => void handleGenerate()}>
              Generate
            </Button>
          </div>
        }
      />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {isLoading ? <InlineAlert tone="info">Loading...</InlineAlert> : null}

      {/* Example history */}
      {examples.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex, i) => (
            <Button
              key={ex.id}
              size="sm"
              variant={selectedExample?.id === ex.id ? "default" : "outline"}
              onClick={() => setSelectedExample(ex)}
            >
              #{i + 1} — Score: {ex.evalScore ?? "?"} <Badge tone={approvalTone(ex.approvalStatus)} className="ml-1">{ex.approvalStatus.replace("_", " ")}</Badge>
            </Button>
          ))}
        </div>
      ) : null}

      {/* Selected example detail */}
      {selectedExample ? (
        <div className="space-y-4">
          {/* Screenshots */}
          {(selectedExample.screenshotFront || selectedExample.screenshotTop || selectedExample.screenshotIso) ? (
            <SectionCard title="Screenshots" description="Front, top, and isometric views">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {selectedExample.screenshotFront ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Front</p>
                    <img
                      src={`data:image/png;base64,${selectedExample.screenshotFront}`}
                      alt="Front view"
                      className="w-full rounded border border-[hsl(var(--border))]"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotTop ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Top</p>
                    <img
                      src={`data:image/png;base64,${selectedExample.screenshotTop}`}
                      alt="Top view"
                      className="w-full rounded border border-[hsl(var(--border))]"
                    />
                  </div>
                ) : null}
                {selectedExample.screenshotIso ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Isometric</p>
                    <img
                      src={`data:image/png;base64,${selectedExample.screenshotIso}`}
                      alt="Isometric view"
                      className="w-full rounded border border-[hsl(var(--border))]"
                    />
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
                {selectedExample.approvalStatus !== "human_approved" && selectedExample.approvalStatus !== "rejected" ? (
                  <>
                    <Button size="sm" variant="outline" iconLeft={<Check className="h-3 w-3" />} loading={busy} onClick={() => void handleApprove()}>
                      Approve
                    </Button>
                    <Button size="sm" variant="destructive" iconLeft={<ThumbsDown className="h-3 w-3" />} loading={busy} onClick={() => void handleReject()}>
                      Reject
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="outline" iconLeft={<RefreshCw className="h-3 w-3" />} loading={busy} onClick={() => void handleRetry()}>
                  Retry
                </Button>
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
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => { setCodeEditValue(selectedExample.code); setEditingCode(true); }}>
                  Edit
                </Button>
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
    </section>
  );
}
