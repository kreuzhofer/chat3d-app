import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  getKnowledgeStats,
  listKnowledgeEntries,
  deleteKnowledgeEntry as apiDeleteEntry,
  updateKnowledgeEntry as apiUpdateEntry,
  listKnowledgeSources,
  createKnowledgeSource,
  updateKnowledgeSource as apiUpdateSource,
  deleteKnowledgeSource as apiDeleteSource,
  triggerCrawl,
  triggerValidate,
  triggerEmbed,
  exportKnowledge,
  importKnowledge,
  createReferenceKnowledgeEntry,
  type KnowledgeEntry,
  type KnowledgeStats,
  type KnowledgeSourceRow,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { useToast } from "../ui/toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface KnowledgeTabProps {
  token: string;
}

const PAGE_SIZE = 25;

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const STRATEGY_LABELS: Record<string, string> = {
  github_file: "GitHub Files",
  github_test_functions: "GitHub Test Functions",
  readthedocs: "ReadTheDocs",
  manual: "Manual",
  reference_upload: "Reference Upload",
  reference_url: "Reference URL",
};

const STRATEGY_OPTIONS = [
  { value: "github_file", label: "GitHub Files" },
  { value: "github_test_functions", label: "GitHub Test Functions" },
  { value: "readthedocs", label: "ReadTheDocs" },
  { value: "manual", label: "Manual" },
  { value: "reference_upload", label: "Reference Upload" },
  { value: "reference_url", label: "Reference URL" },
];

const CRAWL_STATUS_TONE: Record<string, BadgeTone> = {
  idle: "neutral",
  running: "info",
  success: "success",
  error: "danger",
};

const VALIDATION_TONE: Record<string, BadgeTone> = {
  valid: "success",
  invalid: "danger",
  pending: "warning",
  error: "danger",
};

const VALIDATION_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "valid", label: "Valid" },
  { value: "invalid", label: "Invalid" },
  { value: "pending", label: "Pending" },
  { value: "error", label: "Error" },
];

export function KnowledgeTab({ token }: KnowledgeTabProps) {
  const { pushToast } = useToast();

  // ── Data state ──
  const [sources, setSources] = useState<KnowledgeSourceRow[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // ── Filters ──
  const [sourceFilter, setSourceFilter] = useState("");
  const [validationFilter, setValidationFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // ── UI state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busySourceIds, setBusySourceIds] = useState<Set<string>>(new Set());
  const [pipelineBusy, setPipelineBusy] = useState<string | null>(null); // "validate" | "validate-all" | "embed"

  // ── Dialogs ──
  const [sourceDialog, setSourceDialog] = useState<{ mode: "create" | "edit"; source?: KnowledgeSourceRow } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    { type: "source"; id: string; name: string; entryCount: number } |
    { type: "entry"; id: string; title: string } |
    null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Source form state
  const [formName, setFormName] = useState("");
  const [formStrategy, setFormStrategy] = useState("github_file");
  const [formRepo, setFormRepo] = useState("");
  const [formBranch, setFormBranch] = useState("dev");
  const [formDirectory, setFormDirectory] = useState("");
  const [formFileExt, setFormFileExt] = useState(".py");
  const [formSkipPatterns, setFormSkipPatterns] = useState("");
  const [formFuncPrefix, setFormFuncPrefix] = useState("test_");
  const [formMinCodeLen, setFormMinCodeLen] = useState("100");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formPages, setFormPages] = useState("");
  const [formGithubToken, setFormGithubToken] = useState("");
  const [formRefUrl, setFormRefUrl] = useState("");
  const [formRefFormat, setFormRefFormat] = useState("auto");
  const [formRefChunkStrategy, setFormRefChunkStrategy] = useState("none");
  const [formRefTags, setFormRefTags] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // ── Reference entry dialog ──
  const [refDialog, setRefDialog] = useState<{ sourceId: string; sourceName: string } | null>(null);
  const [refTitle, setRefTitle] = useState("");
  const [refSourceUrl, setRefSourceUrl] = useState("");
  const [refDescription, setRefDescription] = useState("");
  const [refContent, setRefContent] = useState("");
  const [refTags, setRefTags] = useState("");
  const [refSaving, setRefSaving] = useState(false);

  // ── Edit entry dialog ──
  const [editDialog, setEditDialog] = useState<KnowledgeEntry | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // ── Export / Import ──
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importConfirm, setImportConfirm] = useState<File | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // ── Data loading ──

  const loadSources = useCallback(async () => {
    try {
      const data = await listKnowledgeSources(token);
      setSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token]);

  const loadStats = useCallback(async () => {
    try {
      const data = await getKnowledgeStats(token);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token]);

  const loadEntries = useCallback(async (currentOffset: number) => {
    try {
      const opts: { sourceId?: string; validationStatus?: string; search?: string; limit: number; offset: number } = {
        limit: PAGE_SIZE,
        offset: currentOffset,
      };
      if (sourceFilter) opts.sourceId = sourceFilter;
      if (validationFilter) opts.validationStatus = validationFilter;
      if (debouncedSearch) opts.search = debouncedSearch;
      const data = await listKnowledgeEntries(token, opts);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, sourceFilter, validationFilter, debouncedSearch]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([loadSources(), loadStats(), loadEntries(offset)]);
    setLoading(false);
  }, [loadSources, loadStats, loadEntries, offset]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setOffset(0);
    setExpandedId(null);
  }, [sourceFilter, validationFilter, debouncedSearch]);

  // Auto-refresh when sources are crawling
  const hasCrawlingSource = sources.some(s => s.lastCrawlStatus === "running");
  useEffect(() => {
    if (!hasCrawlingSource && !pipelineBusy) return;
    const interval = setInterval(() => {
      void loadSources();
      void loadStats();
    }, 3000);
    return () => clearInterval(interval);
  }, [hasCrawlingSource, pipelineBusy, loadSources, loadStats]);

  // ── Source form helpers ──

  function openCreateDialog() {
    setFormName("");
    setFormStrategy("github_file");
    setFormRepo("");
    setFormBranch("dev");
    setFormDirectory("examples");
    setFormFileExt(".py");
    setFormSkipPatterns("");
    setFormFuncPrefix("test_");
    setFormMinCodeLen("100");
    setFormBaseUrl("");
    setFormPages("");
    setFormGithubToken("");
    setFormRefUrl("");
    setFormRefFormat("auto");
    setFormRefChunkStrategy("none");
    setFormRefTags("");
    setSourceDialog({ mode: "create" });
  }

  function openEditDialog(source: KnowledgeSourceRow) {
    setFormName(source.name);
    setFormStrategy(source.strategy);
    const cfg = source.config;
    if (source.strategy === "reference_url") {
      setFormRefUrl((cfg.url as string) ?? "");
      setFormRefFormat((cfg.format as string) ?? "auto");
      setFormRefChunkStrategy((cfg.chunkStrategy as string) ?? "none");
      setFormRefTags(((cfg.tags as string[]) ?? []).join(", "));
    }
    if (source.strategy === "github_file" || source.strategy === "github_test_functions") {
      setFormRepo((cfg.repo as string) ?? "");
      setFormBranch((cfg.branch as string) ?? "dev");
      setFormDirectory((cfg.directory as string) ?? "");
      setFormGithubToken((cfg.githubToken as string) ?? "");
    }
    if (source.strategy === "github_file") {
      setFormFileExt((cfg.fileExtension as string) ?? ".py");
      setFormSkipPatterns(((cfg.skipPatterns as string[]) ?? []).join(", "));
    }
    if (source.strategy === "github_test_functions") {
      setFormFuncPrefix((cfg.functionPrefix as string) ?? "test_");
      setFormMinCodeLen(String((cfg.minCodeLength as number) ?? 100));
    }
    if (source.strategy === "readthedocs") {
      setFormBaseUrl((cfg.baseUrl as string) ?? "");
      setFormPages(((cfg.pages as string[]) ?? []).join("\n"));
    }
    setSourceDialog({ mode: "edit", source });
  }

  function buildConfig(): Record<string, unknown> {
    if (formStrategy === "github_file") {
      const cfg: Record<string, unknown> = {
        repo: formRepo,
        branch: formBranch,
        directory: formDirectory,
        fileExtension: formFileExt,
      };
      const skip = formSkipPatterns.split(",").map(s => s.trim()).filter(Boolean);
      if (skip.length > 0) cfg.skipPatterns = skip;
      if (formGithubToken) cfg.githubToken = formGithubToken;
      return cfg;
    }
    if (formStrategy === "github_test_functions") {
      const cfg: Record<string, unknown> = {
        repo: formRepo,
        branch: formBranch,
        directory: formDirectory,
        functionPrefix: formFuncPrefix,
        minCodeLength: parseInt(formMinCodeLen, 10) || 100,
      };
      if (formGithubToken) cfg.githubToken = formGithubToken;
      return cfg;
    }
    if (formStrategy === "readthedocs") {
      return {
        baseUrl: formBaseUrl,
        pages: formPages.split("\n").map(s => s.trim()).filter(Boolean),
      };
    }
    if (formStrategy === "reference_url") {
      const cfg: Record<string, unknown> = {
        url: formRefUrl,
        format: formRefFormat,
        chunkStrategy: formRefChunkStrategy,
      };
      return cfg;
    }
    return {};
  }

  async function handleSaveSource() {
    setFormSaving(true);
    setError(null);
    try {
      const config = buildConfig();
      if (sourceDialog?.mode === "create") {
        await createKnowledgeSource(token, { name: formName, strategy: formStrategy, config });
        pushToast({ tone: "success", title: "Source created" });
      } else if (sourceDialog?.source) {
        await apiUpdateSource(token, sourceDialog.source.id, { name: formName, config });
        pushToast({ tone: "success", title: "Source updated" });
      }
      setSourceDialog(null);
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSaving(false);
    }
  }

  // ── Actions ──

  async function handleCrawl(sourceId: string) {
    setBusySourceIds(prev => new Set(prev).add(sourceId));
    setError(null);
    try {
      await triggerCrawl(token, sourceId);
      pushToast({ tone: "info", title: "Crawl started", description: "Check source status for progress." });
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySourceIds(prev => { const n = new Set(prev); n.delete(sourceId); return n; });
    }
  }

  async function handleValidate(revalidateAll: boolean) {
    const key = revalidateAll ? "validate-all" : "validate";
    setPipelineBusy(key);
    setError(null);
    try {
      await triggerValidate(token, revalidateAll);
      pushToast({ tone: "info", title: revalidateAll ? "Re-validation started" : "Validation started" });
      // Poll for completion
      setTimeout(() => { void loadStats(); void loadEntries(offset); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPipelineBusy(null);
    }
  }

  async function handleEmbed() {
    setPipelineBusy("embed");
    setError(null);
    try {
      await triggerEmbed(token);
      pushToast({ tone: "info", title: "Embedding started" });
      setTimeout(() => { void loadStats(); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPipelineBusy(null);
    }
  }

  async function executeDelete() {
    if (!deleteConfirm) return;
    setDeleteBusy(true);
    setError(null);
    try {
      if (deleteConfirm.type === "source") {
        await apiDeleteSource(token, deleteConfirm.id);
        pushToast({ tone: "info", title: "Source deleted", description: `${deleteConfirm.name} and ${deleteConfirm.entryCount} entries removed.` });
      } else {
        await apiDeleteEntry(token, deleteConfirm.id);
        pushToast({ tone: "info", title: "Entry deleted" });
      }
      setDeleteConfirm(null);
      setExpandedId(null);
      await Promise.all([loadSources(), loadStats(), loadEntries(offset)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  // ── Export / Import handlers ──

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const backup = await exportKnowledge(token);
      pushToast({ tone: "success", title: "Knowledge exported", description: `Backup "${backup.label}" created. View it on the Backups page.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setImportConfirm(null);
    setError(null);
    try {
      const result = await importKnowledge(token, file);
      pushToast({
        tone: "success",
        title: "Knowledge imported",
        description: `${result.sources} sources, ${result.entries} entries imported.`,
      });
      await Promise.all([loadSources(), loadStats(), loadEntries(0)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  // ── Reference entry handlers ──

  function openRefDialog(sourceId: string, sourceName: string) {
    setRefTitle("");
    setRefSourceUrl("");
    setRefDescription("");
    setRefContent("");
    setRefTags("");
    setRefDialog({ sourceId, sourceName });
  }

  async function handleSaveReference() {
    if (!refDialog) return;
    setRefSaving(true);
    setError(null);
    try {
      await createReferenceKnowledgeEntry(token, {
        sourceId: refDialog.sourceId,
        title: refTitle.trim(),
        content: refContent,
        sourceUrl: refSourceUrl.trim() || undefined,
        description: refDescription.trim() || undefined,
      });
      pushToast({ tone: "success", title: "Reference entry created" });
      setRefDialog(null);
      await Promise.all([loadSources(), loadStats(), loadEntries(offset)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefSaving(false);
    }
  }

  // ── Edit entry dialog handlers ──

  function openEditEntryDialog(entry: KnowledgeEntry) {
    setEditTitle(entry.title);
    setEditSourceUrl(entry.sourceUrl);
    setEditDescription(entry.description ?? "");
    setEditContent(entry.code);
    setEditTags("");
    setEditDialog(entry);
  }

  async function handleSaveEntry() {
    if (!editDialog) return;
    setEditSaving(true);
    setError(null);
    try {
      const patch: { title?: string; description?: string | null; code?: string; sourceUrl?: string } = {};
      if (editTitle.trim() !== editDialog.title) patch.title = editTitle.trim();
      if (editSourceUrl.trim() !== editDialog.sourceUrl) patch.sourceUrl = editSourceUrl.trim();
      if (editDescription.trim() !== (editDialog.description ?? "")) patch.description = editDescription.trim() || null;
      if (editContent !== editDialog.code) patch.code = editContent;

      const contentChanged = editContent !== editDialog.code;
      await apiUpdateEntry(token, editDialog.id, patch);

      pushToast({
        tone: "success",
        title: "Entry updated",
        description: contentChanged ? "Content changed — embedding cleared for re-embedding." : undefined,
      });
      setEditDialog(null);
      await Promise.all([loadStats(), loadEntries(offset)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditSaving(false);
    }
  }

  // ── Derived ──

  const sourceFilterOptions = useMemo(() => [
    { value: "", label: "All sources" },
    ...sources.map(s => ({ value: s.id, label: s.name })),
  ], [sources]);

  const pendingCount = stats?.byValidation.pending ?? 0;
  const validNotEmbedded = stats ? stats.notEmbedded : 0;
  const totalEntries = stats?.total ?? 0;

  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  // ── Render ──

  if (loading && !stats) {
    return <InlineAlert tone="info">Loading knowledge base...</InlineAlert>;
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {/* ── Section 1: Sources ── */}
      <SectionCard
        title="Knowledge Sources"
        description="Configure where to crawl Build123d code examples from."
        actions={
          <Button size="sm" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={openCreateDialog}>
            Add Source
          </Button>
        }
      >
        {sources.length === 0 ? (
          <p className="py-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No sources configured. Add a source to start building the knowledge base.
          </p>
        ) : (
          <div className="rounded-md border border-[hsl(var(--border))]">
            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.3)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <span>Source</span>
              <span>Strategy</span>
              <span>Entries</span>
              <span>Last Crawl</span>
              <span>Actions</span>
            </div>

            {sources.map((source) => {
              const isCrawling = source.lastCrawlStatus === "running" || busySourceIds.has(source.id);
              return (
                <div
                  key={source.id}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 border-b border-[hsl(var(--border))] px-3 py-2 text-sm last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{source.name}</p>
                    {source.lastCrawlStatus === "error" && source.lastCrawlMessage ? (
                      <p className="mt-0.5 text-xs text-[hsl(var(--destructive))]" title={source.lastCrawlMessage}>
                        {source.lastCrawlMessage.slice(0, 80)}
                      </p>
                    ) : source.lastCrawlStatus === "success" ? (
                      <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        {source.lastCrawlAdded ?? 0} added, {source.lastCrawlSkipped ?? 0} skipped
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={source.strategy === "manual" ? "neutral" : "info"}>
                    {STRATEGY_LABELS[source.strategy] ?? source.strategy}
                  </Badge>
                  <span className="text-center font-mono text-xs">{source.entryCount ?? 0}</span>
                  <div className="text-center">
                    <Badge tone={CRAWL_STATUS_TONE[source.lastCrawlStatus ?? "idle"] ?? "neutral"}>
                      {source.lastCrawlStatus ?? "idle"}
                    </Badge>
                    {source.lastCrawlAt ? (
                      <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        {new Date(source.lastCrawlAt).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    {source.strategy !== "manual" && source.strategy !== "reference_upload" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={isCrawling}
                        disabled={isCrawling}
                        iconLeft={<RefreshCw className="h-3 w-3" />}
                        onClick={() => void handleCrawl(source.id)}
                      >
                        Crawl
                      </Button>
                    ) : null}
                    {source.strategy === "reference_upload" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        iconLeft={<Plus className="h-3 w-3" />}
                        onClick={() => openRefDialog(source.id, source.name)}
                      >
                        Add Reference
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit"
                      onClick={() => openEditDialog(source)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete source and all entries"
                      onClick={() => setDeleteConfirm({
                        type: "source",
                        id: source.id,
                        name: source.name,
                        entryCount: source.entryCount ?? 0,
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--destructive))]" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Section 2: Pipeline ── */}
      <SectionCard title="Pipeline" description="Process entries through validation and embedding stages.">
        <div className="flex flex-wrap items-stretch gap-3">
          {/* Crawl stage */}
          <PipelineStage label="Crawl" count={totalEntries} description="total entries" />
          <ArrowRight className="hidden self-center text-[hsl(var(--muted-foreground))] sm:block h-4 w-4" />

          {/* Validate stage */}
          <div className="flex flex-1 flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 min-w-[140px]">
            <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Validate</p>
            <p className="text-xl font-bold">{pendingCount}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">pending</p>
            <div className="flex gap-1">
              <Button
                variant="default"
                size="sm"
                disabled={pendingCount === 0 || pipelineBusy !== null}
                loading={pipelineBusy === "validate"}
                onClick={() => void handleValidate(false)}
              >
                Validate ({pendingCount})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={totalEntries === 0 || pipelineBusy !== null}
                loading={pipelineBusy === "validate-all"}
                onClick={() => void handleValidate(true)}
                title="Re-validate all entries"
              >
                Re-validate All
              </Button>
            </div>
          </div>
          <ArrowRight className="hidden self-center text-[hsl(var(--muted-foreground))] sm:block h-4 w-4" />

          {/* Embed stage */}
          <div className="flex flex-1 flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 min-w-[140px]">
            <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Embed</p>
            <p className="text-xl font-bold">{validNotEmbedded}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">pending</p>
            <Button
              variant="default"
              size="sm"
              disabled={validNotEmbedded === 0 || pipelineBusy !== null}
              loading={pipelineBusy === "embed"}
              onClick={() => void handleEmbed()}
            >
              Embed ({validNotEmbedded})
            </Button>
          </div>
        </div>

        {/* Summary badges */}
        {stats ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(stats.byValidation).map(([status, count]) => (
              <Badge key={status} tone={VALIDATION_TONE[status] ?? "neutral"}>
                {status}: {count}
              </Badge>
            ))}
            <Badge tone="info">embedded: {stats.embedded}</Badge>
          </div>
        ) : null}
      </SectionCard>

      {/* ── Section 3: Data Transfer ── */}
      <SectionCard
        title="Data Transfer"
        description="Export all knowledge data (sources + entries + embeddings) or import from a previous export."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            iconLeft={<Download className="h-3.5 w-3.5" />}
            onClick={() => void handleExport()}
            disabled={exporting || totalEntries === 0}
          >
            {exporting ? "Exporting…" : "Export"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            iconLeft={<Upload className="h-3.5 w-3.5" />}
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
          >
            {importing ? "Importing…" : "Import"}
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setImportConfirm(file);
              e.target.value = "";
            }}
          />

          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Exports appear on the Backups page for download.
          </span>
        </div>
      </SectionCard>

      {/* ── Section 4: Entries ── */}
      <SectionCard title="Entries" description="Browse and inspect knowledge base entries.">
        {/* Filter bar */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="w-48">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title or content..."
            />
          </div>
          <div className="w-52">
            <Select
              options={sourceFilterOptions}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Select
              options={VALIDATION_OPTIONS}
              value={validationFilter}
              onChange={(e) => setValidationFilter(e.target.value)}
            />
          </div>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        </div>

        {/* Entry table */}
        <div className="rounded-md border border-[hsl(var(--border))]">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.3)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <span>Title</span>
            <span>Source</span>
            <span>Status</span>
            <span />
          </div>

          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No entries found.
            </div>
          ) : (
            entries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const sourceName = sources.find(s => s.id === entry.sourceId)?.name ?? entry.sourceType;
              return (
                <div key={entry.id} className="border-b border-[hsl(var(--border))] last:border-b-0">
                  <button
                    type="button"
                    className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[hsl(var(--muted)_/_0.2)]"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                        : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                      }
                      <span className="truncate">{entry.title}</span>
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))] max-w-[120px] truncate">
                      {sourceName}
                    </span>
                    <Badge tone={VALIDATION_TONE[entry.validationStatus] ?? "neutral"}>
                      {entry.validationStatus}
                    </Badge>
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <span
                        role="button"
                        tabIndex={0}
                        className="inline-flex items-center rounded p-1 text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                        onClick={(e) => { e.stopPropagation(); openEditEntryDialog(entry); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); openEditEntryDialog(entry); } }}
                        title="Edit entry"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="inline-flex items-center rounded p-1 text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)_/_0.1)]"
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: "entry", id: entry.id, title: entry.title }); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setDeleteConfirm({ type: "entry", id: entry.id, title: entry.title }); } }}
                        title="Delete entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-[hsl(var(--border)_/_0.5)] bg-[hsl(var(--muted)_/_0.1)] px-4 py-3 space-y-3">
                      <div>
                        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Source URL</span>
                        <a
                          href={entry.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 flex items-center gap-1 text-sm text-[hsl(var(--info))] hover:underline break-all"
                        >
                          {entry.sourceUrl}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                      {entry.description ? (
                        <div>
                          <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Description</span>
                          <p className="mt-0.5 text-sm">{entry.description}</p>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                          {entry.sourceType === "reference" ? "Content" : "Code"}
                        </span>
                        {entry.sourceType === "reference" ? (
                          <div className="mt-1 max-h-80 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 text-sm leading-relaxed whitespace-pre-wrap [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[hsl(var(--border))] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:bg-[hsl(var(--muted)_/_0.3)] [&_td]:border [&_td]:border-[hsl(var(--border))] [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:text-xs [&_p]:text-xs [&_p]:mb-1">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.code}</ReactMarkdown>
                          </div>
                        ) : (
                          <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                            {entry.code}
                          </pre>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                        <span>Validated: {entry.validatedAt ? new Date(entry.validatedAt).toLocaleString() : "never"}</span>
                        <span>Embedding: {entry.embeddingModel ?? "none"}</span>
                        <span>Created: {new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {total > 0 ? (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Showing {pageStart}–{pageEnd} of {total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* ── Source Create/Edit Dialog ── */}
      <Dialog
        open={sourceDialog !== null}
        title={sourceDialog?.mode === "create" ? "Add Knowledge Source" : "Edit Knowledge Source"}
        onClose={() => { if (!formSaving) setSourceDialog(null); }}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Name</label>
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Build123d GitHub Examples" />
          </div>

          {sourceDialog?.mode === "create" ? (
            <div>
              <label className="mb-1 block text-xs font-medium">Strategy</label>
              <Select options={STRATEGY_OPTIONS} value={formStrategy} onChange={(e) => setFormStrategy(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium">Strategy</label>
              <p className="text-sm">{STRATEGY_LABELS[formStrategy] ?? formStrategy}</p>
            </div>
          )}

          {/* GitHub config fields */}
          {(formStrategy === "github_file" || formStrategy === "github_test_functions") ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Repository (owner/name)</label>
                <Input value={formRepo} onChange={(e) => setFormRepo(e.target.value)} placeholder="gumyr/build123d" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Branch</label>
                  <Input value={formBranch} onChange={(e) => setFormBranch(e.target.value)} placeholder="dev" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Directory</label>
                  <Input value={formDirectory} onChange={(e) => setFormDirectory(e.target.value)} placeholder="examples" />
                </div>
              </div>
              {formStrategy === "github_file" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium">File extension</label>
                    <Input value={formFileExt} onChange={(e) => setFormFileExt(e.target.value)} placeholder=".py" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Skip patterns (comma-separated)</label>
                    <Input value={formSkipPatterns} onChange={(e) => setFormSkipPatterns(e.target.value)} placeholder="*_algebra*" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Function prefix</label>
                    <Input value={formFuncPrefix} onChange={(e) => setFormFuncPrefix(e.target.value)} placeholder="test_" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Min code length</label>
                    <Input type="number" value={formMinCodeLen} onChange={(e) => setFormMinCodeLen(e.target.value)} />
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium">GitHub Token (optional, for rate limits)</label>
                <Input type="password" value={formGithubToken} onChange={(e) => setFormGithubToken(e.target.value)} placeholder="ghp_..." />
              </div>
            </>
          ) : null}

          {/* ReadTheDocs config */}
          {formStrategy === "readthedocs" ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Base URL</label>
                <Input value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://build123d.readthedocs.io/en/latest" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Pages (one per line)</label>
                <textarea
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 text-sm font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  rows={5}
                  value={formPages}
                  onChange={(e) => setFormPages(e.target.value)}
                  placeholder={"introductory_examples.html\ntutorial_design.html"}
                />
              </div>
            </>
          ) : null}

          {formStrategy === "manual" ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Manual sources have no crawl configuration. Add entries directly from the entries section.
            </p>
          ) : null}

          {formStrategy === "reference_upload" ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Reference sources hold non-code knowledge (specs, docs, guides) in Markdown format.
              After creating the source, use &ldquo;Add Reference&rdquo; to add entries.
              Reference entries are auto-validated and use a wider embedding window.
            </p>
          ) : null}

          {formStrategy === "reference_url" ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">URL</label>
                <Input value={formRefUrl} onChange={(e) => setFormRefUrl(e.target.value)} placeholder="https://example.com/spec.html" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Format</label>
                  <Select
                    options={[
                      { value: "auto", label: "Auto-detect" },
                      { value: "md", label: "Markdown" },
                      { value: "html", label: "HTML" },
                      { value: "csv", label: "CSV" },
                    ]}
                    value={formRefFormat}
                    onChange={(e) => setFormRefFormat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Chunking</label>
                  <Select
                    options={[
                      { value: "none", label: "None (single entry)" },
                      { value: "heading", label: "By heading (## sections)" },
                      { value: "fixed", label: "Fixed size (~4000 chars)" },
                    ]}
                    value={formRefChunkStrategy}
                    onChange={(e) => setFormRefChunkStrategy(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                The URL will be fetched and converted to Markdown when crawled.
                Reference entries are auto-validated and use a wider embedding window.
              </p>
            </>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={formSaving} onClick={() => setSourceDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={formSaving}
              disabled={formSaving || !formName.trim()}
              onClick={() => void handleSaveSource()}
            >
              {sourceDialog?.mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog
        open={deleteConfirm !== null}
        title={deleteConfirm?.type === "source" ? "Delete Source" : "Delete Entry"}
        description={
          deleteConfirm?.type === "source"
            ? `Delete "${deleteConfirm.name}" and all ${deleteConfirm.entryCount} entries? This cannot be undone.`
            : deleteConfirm?.type === "entry"
              ? `Delete "${deleteConfirm.title}"? This cannot be undone.`
              : undefined
        }
        onClose={() => { if (!deleteBusy) setDeleteConfirm(null); }}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={deleteBusy} onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="destructive" loading={deleteBusy} disabled={deleteBusy} onClick={() => void executeDelete()}>
            Delete
          </Button>
        </div>
      </Dialog>

      {/* ── Import Confirmation Dialog ── */}
      <Dialog
        open={importConfirm !== null}
        title="Import Knowledge"
        description={`This will REPLACE ALL existing knowledge sources and entries with the data from "${importConfirm?.name}". This action cannot be undone.`}
        onClose={() => { if (!importing) setImportConfirm(null); }}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={importing} onClick={() => setImportConfirm(null)}>Cancel</Button>
          <Button
            variant="destructive"
            loading={importing}
            disabled={importing}
            onClick={() => { if (importConfirm) void handleImport(importConfirm); }}
          >
            Replace All Data
          </Button>
        </div>
      </Dialog>

      {/* ── Add Reference Dialog ── */}
      <Dialog
        open={refDialog !== null}
        title="Add Reference Entry"
        description={refDialog ? `Add a reference knowledge entry to "${refDialog.sourceName}".` : undefined}
        onClose={() => { if (!refSaving) setRefDialog(null); }}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Title</label>
            <Input value={refTitle} onChange={(e) => setRefTitle(e.target.value)} placeholder="e.g. IPC-2221 PCB Trace Width Guidelines" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Source URL (optional)</label>
            <Input value={refSourceUrl} onChange={(e) => setRefSourceUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Description (optional)</label>
            <Input value={refDescription} onChange={(e) => setRefDescription(e.target.value)} placeholder="Brief summary of the reference content" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Content (Markdown)</label>
            <textarea
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 text-sm font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              rows={12}
              value={refContent}
              onChange={(e) => setRefContent(e.target.value)}
              placeholder={"# Reference Title\n\nPaste or write Markdown content here...\n\nThis content will be embedded for semantic search."}
            />
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {refContent.length} characters. Reference entries use a 2000-char embedding window.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={refSaving} onClick={() => setRefDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={refSaving}
              disabled={refSaving || !refTitle.trim() || !refContent.trim()}
              onClick={() => void handleSaveReference()}
            >
              Create Entry
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── Edit Entry Dialog ── */}
      <Dialog
        open={editDialog !== null}
        title="Edit Knowledge Entry"
        onClose={() => { if (!editSaving) setEditDialog(null); }}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Title</label>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Source URL</label>
            <Input value={editSourceUrl} onChange={(e) => setEditSourceUrl(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Description</label>
            <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              {editDialog?.sourceType === "reference" ? "Content (Markdown)" : "Code"}
            </label>
            <textarea
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 font-mono text-xs leading-relaxed"
              rows={14}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
            {editDialog && editContent !== editDialog.code ? (
              <p className="mt-1 text-xs text-[hsl(var(--warning))]">
                Content changed — embedding will be cleared on save, requiring re-embedding.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={editSaving} onClick={() => setEditDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={editSaving}
              disabled={editSaving || !editTitle.trim()}
              onClick={() => void handleSaveEntry()}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function PipelineStage({ label, count, description }: { label: string; count: number; description: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-md border border-[hsl(var(--border))] p-3 min-w-[120px]">
      <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="text-xl font-bold">{count}</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
    </div>
  );
}
