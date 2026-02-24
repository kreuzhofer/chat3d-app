import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FolderOpen, RefreshCw, Sprout } from "lucide-react";
import {
  getExportStats,
  listCategories,
  seedCategories,
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const [cats, exportStats] = await Promise.all([
        listCategories(token),
        getExportStats(token),
      ]);
      setCategories(cats);
      setStats(exportStats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

      {categories.length === 0 && !isLoading ? (
        <SectionCard title="No categories" description="Run 'Seed from files' to populate categories and prompts from the workbench directory.">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Place category Markdown files in <code>workbench/categories/</code> and click the seed button.
          </p>
        </SectionCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 text-left transition hover:border-[hsl(var(--primary)_/_0.5)] hover:shadow-md"
              onClick={() => navigate(`/workbench/${cat.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
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
              {cat.pendingCount > 0 ? (
                <div className="mt-2 flex gap-1.5">
                  <Badge tone="warning">{cat.pendingCount} pending</Badge>
                </div>
              ) : null}
            </button>
          ))}
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
