import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Sparkles } from "lucide-react";
import {
  generateForPrompt,
  listCategories,
  listPromptsForCategory,
  type WorkbenchCategory,
  type WorkbenchPrompt,
} from "../api/workbench.api";
import { useAuth } from "../hooks/useAuth";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

type Filter = "all" | "pending" | "approved" | "no_examples";

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
  const [generatingPromptId, setGeneratingPromptId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token || !categoryId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [cats, promptList] = await Promise.all([
        listCategories(token),
        listPromptsForCategory(token, categoryId),
      ]);
      const cat = cats.find((c) => c.id === categoryId) ?? null;
      setCategory(cat);
      setPrompts(promptList);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      setGeneratingPromptId(promptId);
      setError(null);
      try {
        const result = await generateForPrompt(token, promptId);
        pushToast({
          tone: result.approvalStatus === "auto_approved" ? "success" : "info",
          title: result.approvalStatus === "auto_approved" ? "Auto-approved!" : "Generation complete",
          description: `Score: ${result.evalScore ?? "N/A"}, iteration: ${result.iteration}`,
        });
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGeneratingPromptId(null);
      }
    },
    [loadData, pushToast, token],
  );

  return (
    <section className="space-y-4">
      <PageHeader
        title={category?.name ?? "Category"}
        description={category?.description}
        breadcrumbs={["Admin", "Workbench", category?.name ?? "..."]}
        actions={
          <Button variant="outline" size="sm" iconLeft={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate("/workbench")}>
            Back
          </Button>
        }
      />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

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
          {filteredPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className="flex items-center gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 transition hover:border-[hsl(var(--primary)_/_0.3)]"
            >
              <span className="w-8 shrink-0 text-right text-xs font-mono text-[hsl(var(--muted-foreground))]">
                {prompt.index}
              </span>

              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm text-[hsl(var(--foreground))] hover:underline"
                onClick={() => navigate(`/workbench/${categoryId}/${prompt.id}`)}
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
                  iconLeft={generatingPromptId === prompt.id ? <Sparkles className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  loading={generatingPromptId === prompt.id}
                  disabled={generatingPromptId !== null}
                  onClick={() => void handleGenerate(prompt.id)}
                >
                  Generate
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
