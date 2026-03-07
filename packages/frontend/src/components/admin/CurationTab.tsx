import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Eye, ExternalLink, ImageIcon, Loader2, Plus, Search, Sparkles, Star, Tag, ThumbsDown, Wand2, X } from "lucide-react";
import { downloadFileBinary } from "../../api/files.api";
import {
  listCurationCandidates,
  getCurationCandidateDetail,
  updateCurationCandidate,
  distillCandidatePrompt,
  updateCandidatePrompt,
  suggestCandidateTags,
  approveCurationCandidate,
  checkCandidateSimilarity,
  listTags,
  addCandidateTag,
  removeCandidateTag,
  type CurationCandidateRow,
  type CurationCandidateDetail,
  type CurationStatus,
  type CurationTag,
  type SimilarityCheckResult,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Drawer } from "../ui/drawer";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

interface CurationTabProps {
  token: string;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "reviewing", label: "Reviewing" },
  { value: "dismissed", label: "Dismissed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function statusBadgeTone(status: CurationStatus): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "pending": return "info";
    case "reviewing": return "warning";
    case "approved": return "success";
    case "rejected": return "danger";
    case "dismissed": return "neutral";
  }
}

/**
 * Extract the ISO screenshot path from a chat item's messages JSONB.
 * Previews contain { path, filename } entries — we prefer the isometric angle.
 */
function extractScreenshotPath(messages: unknown[]): string | null {
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;

    if (Array.isArray(m.previews)) {
      // Prefer isometric screenshot
      for (const preview of m.previews) {
        if (typeof preview !== "object" || preview === null) continue;
        const p = preview as Record<string, unknown>;
        if (typeof p.path === "string" && (p.path as string).includes("screenshot-isometric")) {
          return p.path as string;
        }
      }
      // Fallback: first preview with "screenshot" in the path
      for (const preview of m.previews) {
        if (typeof preview !== "object" || preview === null) continue;
        const p = preview as Record<string, unknown>;
        if (typeof p.path === "string" && (p.path as string).includes("screenshot")) {
          return p.path as string;
        }
      }
    }

    if (Array.isArray(m.files)) {
      for (const file of m.files) {
        if (typeof file !== "object" || file === null) continue;
        const f = file as Record<string, unknown>;
        if (typeof f.path === "string" && (f.path as string).includes("screenshot")) {
          return f.path as string;
        }
      }
    }
  }
  return null;
}

/**
 * Extract text from a messages JSONB array.
 */
function extractText(messages: unknown[]): string {
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;
    if (typeof m.text === "string" && m.text.trim().length > 0) {
      return m.text.length > 120 ? m.text.slice(0, 120) + "..." : m.text;
    }
  }
  return "(no text)";
}

/** Fetch an image via the authenticated files API and render as a blob URL. */
function AuthImage({ filePath, token, alt, className }: { filePath: string; token: string; alt: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    downloadFileBinary({ token, path: filePath })
      .then(({ blob }) => {
        if (revoked) return;
        setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!revoked) setError(true);
      });
    return () => {
      revoked = true;
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [filePath, token]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-[hsl(var(--muted)_/_0.3)] ${className ?? ""}`}>
        <ImageIcon className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className={`flex items-center justify-center bg-[hsl(var(--muted)_/_0.3)] ${className ?? ""}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--muted-foreground))]" />
      </div>
    );
  }

  return <img src={objectUrl} alt={alt} className={className} />;
}

export function CurationTab({ token }: CurationTabProps) {
  const [candidates, setCandidates] = useState<CurationCandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selectedDetail, setSelectedDetail] = useState<CurationCandidateDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Prompt editing state
  const [editedPrompt, setEditedPrompt] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Tag state
  const [suggestingTags, setSuggestingTags] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Approval state
  const [approving, setApproving] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  // Similarity check state
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);
  const [similarityResult, setSimilarityResult] = useState<SimilarityCheckResult | null>(null);

  const loadData = useCallback(async () => {
    try {
      const result = await listCurationCandidates(token, { status: statusFilter });
      setCandidates(result.candidates);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

  // Load all tags for autocomplete when drawer opens
  useEffect(() => {
    if (drawerOpen) {
      void listTags(token).then((result) => {
        setAllTags(result.tags.map((t) => t.name));
      }).catch(() => { /* ignore */ });
    }
  }, [drawerOpen, token]);

  // Sync editedPrompt and reset similarity when detail changes
  useEffect(() => {
    if (selectedDetail?.distilledPrompt) {
      setEditedPrompt(selectedDetail.distilledPrompt);
    } else {
      setEditedPrompt("");
    }
    setPromptDirty(false);
    setSimilarityResult(null);
  }, [selectedDetail?.id, selectedDetail?.distilledPrompt]);

  // Autocomplete suggestions based on input
  useEffect(() => {
    if (newTagInput.trim().length === 0) {
      setTagSuggestions([]);
      return;
    }
    const lower = newTagInput.toLowerCase().trim();
    const currentTagNames = selectedDetail?.tags.map((t) => t.name) ?? [];
    const suggestions = allTags
      .filter((t) => t.includes(lower) && !currentTagNames.includes(t))
      .slice(0, 5);
    setTagSuggestions(suggestions);
  }, [newTagInput, allTags, selectedDetail?.tags]);

  async function handleReview(candidateId: string) {
    setBusyIds((prev) => new Set(prev).add(candidateId));
    try {
      const detail = await getCurationCandidateDetail(token, candidateId);
      setSelectedDetail(detail);
      setDrawerOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
    }
  }

  async function handleStatusUpdate(candidateId: string, status: CurationStatus, notes?: string) {
    setBusyIds((prev) => new Set(prev).add(candidateId));
    setError(null);
    try {
      await updateCurationCandidate(token, candidateId, { status, notes });
      if (selectedDetail?.id === candidateId) {
        setDrawerOpen(false);
        setSelectedDetail(null);
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
    }
  }

  async function handleDistill() {
    if (!selectedDetail) return;
    setDistilling(true);
    setError(null);
    try {
      const result = await distillCandidatePrompt(token, selectedDetail.id);
      setSelectedDetail((prev) =>
        prev ? { ...prev, distilledPrompt: result.distilledPrompt, originalPrompt: result.originalPrompt } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDistilling(false);
    }
  }

  async function handleSavePrompt() {
    if (!selectedDetail || !promptDirty) return;
    setSavingPrompt(true);
    setError(null);
    try {
      const result = await updateCandidatePrompt(token, selectedDetail.id, editedPrompt);
      setSelectedDetail((prev) =>
        prev ? { ...prev, distilledPrompt: result.distilledPrompt } : prev,
      );
      setPromptDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPrompt(false);
    }
  }

  async function handleSuggestTags() {
    if (!selectedDetail) return;
    setSuggestingTags(true);
    setError(null);
    try {
      const result = await suggestCandidateTags(token, selectedDetail.id);
      setSelectedDetail((prev) =>
        prev ? { ...prev, tags: result.tags } : prev,
      );
      // Refresh all tags for autocomplete
      void listTags(token).then((r) => setAllTags(r.tags.map((t) => t.name))).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggestingTags(false);
    }
  }

  async function handleAddTag(tagName: string) {
    if (!selectedDetail || !tagName.trim()) return;
    setAddingTag(true);
    setError(null);
    try {
      const newTag = await addCandidateTag(token, selectedDetail.id, tagName.trim());
      setSelectedDetail((prev) => {
        if (!prev) return prev;
        // Avoid duplicates
        if (prev.tags.some((t) => t.id === newTag.id)) return prev;
        return { ...prev, tags: [...prev.tags, newTag] };
      });
      setNewTagInput("");
      setTagSuggestions([]);
      // Refresh all tags for autocomplete
      void listTags(token).then((r) => setAllTags(r.tags.map((t) => t.name))).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingTag(false);
    }
  }

  async function handleRemoveTag(tagId: string) {
    if (!selectedDetail) return;
    setError(null);
    try {
      await removeCandidateTag(token, selectedDetail.id, tagId);
      setSelectedDetail((prev) =>
        prev ? { ...prev, tags: prev.tags.filter((t) => t.id !== tagId) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleApprove() {
    if (!selectedDetail) return;
    setApproving(true);
    setError(null);
    try {
      await approveCurationCandidate(token, selectedDetail.id);
      setShowApproveConfirm(false);
      setDrawerOpen(false);
      setSelectedDetail(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }

  async function handleCheckSimilarity() {
    if (!selectedDetail) return;
    setCheckingSimilarity(true);
    setError(null);
    try {
      const result = await checkCandidateSimilarity(token, selectedDetail.id);
      setSimilarityResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingSimilarity(false);
    }
  }

  if (loading) {
    return <InlineAlert tone="info">Loading curation candidates...</InlineAlert>;
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <SectionCard
        title="Content Curation Queue"
        description={`${total} candidate${total !== 1 ? "s" : ""} total. Review user-generated models for quality and potential promotion to the workbench library.`}
      >
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Status:</label>
          <div className="w-40">
            <Select
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          </div>
        </div>

        {candidates.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No candidates match the current filter.
          </p>
        ) : (
          <div className="space-y-3">
            {candidates.map((c) => {
              const busy = busyIds.has(c.id);
              const screenshotPath = c.lastAssistantItem
                ? extractScreenshotPath(c.lastAssistantItem.messages as unknown[])
                : null;

              return (
                <div
                  key={c.id}
                  className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] p-3"
                >
                  {/* Thumbnail */}
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                    {screenshotPath ? (
                      <AuthImage
                        filePath={screenshotPath}
                        token={token}
                        alt="Model preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-[hsl(var(--muted-foreground))]">
                        No img
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {c.chatContext.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={statusBadgeTone(c.status)}>{c.status}</Badge>
                      <span className="flex items-center gap-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <Star className="h-3 w-3" /> {c.totalLikes}
                      </span>
                      <span className="flex items-center gap-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <Download className="h-3 w-3" /> {c.totalDownloads}
                      </span>
                      {c.chatContext.deletedAt ? (
                        <Badge tone="warning">deleted</Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleReview(c.id)}
                      title="Review"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {c.status === "pending" || c.status === "reviewing" ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleStatusUpdate(c.id, "dismissed")}
                          title="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleStatusUpdate(c.id, "rejected")}
                          title="Reject"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Detail Drawer */}
      <Drawer
        open={drawerOpen}
        title="Candidate Review"
        description="View the full conversation and model details."
        onClose={() => {
          setDrawerOpen(false);
          setSelectedDetail(null);
        }}
      >
        {selectedDetail ? (
          <div className="space-y-4">
            {/* Screenshot from last assistant item */}
            {(() => {
              const lastAssistant = [...selectedDetail.conversationItems]
                .reverse()
                .find((i) => i.role === "assistant");
              const path = lastAssistant
                ? extractScreenshotPath(lastAssistant.messages as unknown[])
                : null;
              return path ? (
                <AuthImage
                  filePath={path}
                  token={token}
                  alt="Model preview"
                  className="w-full rounded-md border border-[hsl(var(--border))]"
                />
              ) : null;
            })()}

            {/* Stats */}
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusBadgeTone(selectedDetail.status)}>
                {selectedDetail.status}
              </Badge>
              <span className="flex items-center gap-0.5 text-sm">
                <Star className="h-3.5 w-3.5" /> {selectedDetail.totalLikes} likes
              </span>
              <span className="flex items-center gap-0.5 text-sm">
                <Download className="h-3.5 w-3.5" /> {selectedDetail.totalDownloads} downloads
              </span>
            </div>

            {/* Promoted badge */}
            {selectedDetail.workbenchExampleId ? (
              <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.1)] p-3">
                <Check className="h-4 w-4 text-[hsl(var(--success))]" />
                <span className="text-sm font-medium text-[hsl(var(--success))]">
                  Promoted to Workbench
                </span>
                <a
                  href={`/workbench`}
                  className="ml-auto flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : null}

            {/* Context info */}
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Chat: {selectedDetail.chatContext.name}
                {selectedDetail.chatContext.deletedAt ? " (soft-deleted)" : ""}
              </p>
            </div>

            {/* Prompt Section */}
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Wand2 className="h-3.5 w-3.5" /> Distilled Prompt
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={distilling}
                  onClick={() => void handleDistill()}
                >
                  {distilling ? (
                    <><Spinner size="sm" /> Distilling...</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5" /> Distill Prompt</>
                  )}
                </Button>
              </div>

              {selectedDetail.distilledPrompt ? (
                <div className="space-y-2">
                  <Textarea
                    value={editedPrompt}
                    onChange={(e) => {
                      setEditedPrompt(e.target.value);
                      setPromptDirty(e.target.value !== selectedDetail.distilledPrompt);
                    }}
                    className="min-h-[80px] text-sm"
                  />
                  {promptDirty ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={savingPrompt}
                        onClick={() => void handleSavePrompt()}
                      >
                        {savingPrompt ? "Saving..." : "Save Prompt"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditedPrompt(selectedDetail.distilledPrompt ?? "");
                          setPromptDirty(false);
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  No distilled prompt yet. Click "Distill Prompt" to generate one from the conversation.
                </p>
              )}

              {selectedDetail.originalPrompt && selectedDetail.originalPrompt !== selectedDetail.distilledPrompt ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[hsl(var(--muted-foreground))]">
                    Original prompt
                  </summary>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))] italic">
                    {selectedDetail.originalPrompt}
                  </p>
                </details>
              ) : null}
            </div>

            {/* Similarity Check Section */}
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Search className="h-3.5 w-3.5" /> Similarity Check
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={checkingSimilarity || !selectedDetail.distilledPrompt}
                  onClick={() => void handleCheckSimilarity()}
                  title={!selectedDetail.distilledPrompt ? "Distill prompt first" : undefined}
                >
                  {checkingSimilarity ? (
                    <><Spinner size="sm" /> Checking...</>
                  ) : (
                    <><Search className="h-3.5 w-3.5" /> Check Similarity</>
                  )}
                </Button>
              </div>

              {similarityResult ? (
                <div className="space-y-3">
                  {/* Novelty score badge */}
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        similarityResult.maxSimilarity > 0.85
                          ? "danger"
                          : similarityResult.maxSimilarity > 0.70
                            ? "warning"
                            : "success"
                      }
                    >
                      {similarityResult.maxSimilarity > 0.85
                        ? "Likely duplicate"
                        : similarityResult.maxSimilarity > 0.70
                          ? "Similar exists"
                          : "Novel"}
                    </Badge>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      Max similarity: {Math.round(similarityResult.maxSimilarity * 100)}%
                      {" | "}Novelty: {Math.round(similarityResult.noveltyScore * 100)}%
                    </span>
                  </div>

                  {/* Similar matches */}
                  {similarityResult.matches.length > 0 ? (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {similarityResult.matches.map((match) => (
                        <div
                          key={match.exampleId}
                          className="flex items-start gap-2 rounded-md border border-[hsl(var(--border))] p-2"
                        >
                          {/* Thumbnail */}
                          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                            {match.screenshotPath ? (
                              <AuthImage
                                filePath={match.screenshotPath}
                                token={token}
                                alt="Similar model"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <ImageIcon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                              </div>
                            )}
                          </div>
                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-snug text-[hsl(var(--foreground))]">
                              {match.prompt.length > 80
                                ? match.prompt.slice(0, 80) + "..."
                                : match.prompt}
                            </p>
                            <Badge
                              tone={
                                match.similarity > 0.85
                                  ? "danger"
                                  : match.similarity > 0.70
                                    ? "warning"
                                    : "success"
                              }
                            >
                              {Math.round(match.similarity * 100)}% similar
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      No existing workbench examples with embeddings found.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {selectedDetail.distilledPrompt
                    ? "Click \"Check Similarity\" to compare against existing workbench entries."
                    : "Distill the prompt first, then check for similar existing models."}
                </p>
              )}
            </div>

            {/* Tags Section */}
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Tag className="h-3.5 w-3.5" /> Tags
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={suggestingTags || !selectedDetail.distilledPrompt}
                  onClick={() => void handleSuggestTags()}
                  title={!selectedDetail.distilledPrompt ? "Distill prompt first" : undefined}
                >
                  {suggestingTags ? (
                    <><Spinner size="sm" /> Suggesting...</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5" /> Suggest Tags</>
                  )}
                </Button>
              </div>

              {/* Current tags */}
              {selectedDetail.tags.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedDetail.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-0.5 text-xs"
                    >
                      {tag.name}
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        ({tag.suggestedBy})
                      </span>
                      <button
                        className="ml-0.5 rounded-full p-0.5 hover:bg-[hsl(var(--destructive)_/_0.1)]"
                        onClick={() => void handleRemoveTag(tag.id)}
                        title="Remove tag"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
                  No tags yet.{" "}
                  {selectedDetail.distilledPrompt
                    ? "Click \"Suggest Tags\" or add tags manually."
                    : "Distill the prompt first, then suggest tags."}
                </p>
              )}

              {/* Add tag input */}
              <div className="relative flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    ref={tagInputRef}
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTagInput.trim()) {
                        e.preventDefault();
                        void handleAddTag(newTagInput);
                      }
                    }}
                    placeholder="Add tag..."
                    className="text-sm"
                  />
                  {/* Autocomplete dropdown */}
                  {tagSuggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-md">
                      {tagSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[hsl(var(--muted))]"
                          onClick={() => void handleAddTag(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={addingTag || !newTagInput.trim()}
                  onClick={() => void handleAddTag(newTagInput)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Conversation history */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Conversation</h3>
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
                {selectedDetail.conversationItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-md p-2 text-xs ${
                      item.role === "user"
                        ? "bg-[hsl(var(--primary)_/_0.1)]"
                        : "bg-[hsl(var(--muted))]"
                    }`}
                  >
                    <span className="font-medium">
                      {item.role === "user" ? "User" : "Assistant"}:
                    </span>{" "}
                    {extractText(item.messages as unknown[])}
                    {item.role === "assistant" && (item.rating > 0 || item.downloadCount > 0) ? (
                      <span className="ml-2 text-[hsl(var(--muted-foreground))]">
                        {item.rating > 0 ? `${item.rating} like` : ""}
                        {item.rating > 0 && item.downloadCount > 0 ? ", " : ""}
                        {item.downloadCount > 0 ? `${item.downloadCount} dl` : ""}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            {selectedDetail.status === "pending" || selectedDetail.status === "reviewing" ? (
              <div className="space-y-3 border-t border-[hsl(var(--border))] pt-3">
                {/* Approve confirmation */}
                {showApproveConfirm ? (
                  <div className="rounded-md border border-[hsl(var(--warning)_/_0.5)] bg-[hsl(var(--warning)_/_0.05)] p-3">
                    <p className="mb-2 text-sm font-medium">
                      Promote this model to the workbench library?
                    </p>
                    <p className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">
                      This will copy files, create a workbench entry, generate an embedding, and attach tags.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={approving}
                        onClick={() => void handleApprove()}
                      >
                        {approving ? (
                          <><Spinner size="sm" /> Promoting...</>
                        ) : (
                          <><Check className="h-3.5 w-3.5" /> Confirm Approve</>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={approving}
                        onClick={() => setShowApproveConfirm(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  {selectedDetail.status === "pending" ? (
                    <Button
                      variant="outline"
                      disabled={busyIds.has(selectedDetail.id)}
                      onClick={() =>
                        void handleStatusUpdate(selectedDetail.id, "reviewing")
                      }
                    >
                      Mark Reviewing
                    </Button>
                  ) : null}
                  <Button
                    disabled={
                      busyIds.has(selectedDetail.id) ||
                      approving ||
                      !selectedDetail.distilledPrompt ||
                      showApproveConfirm
                    }
                    onClick={() => setShowApproveConfirm(true)}
                    title={!selectedDetail.distilledPrompt ? "Distill prompt first" : undefined}
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busyIds.has(selectedDetail.id)}
                    onClick={() =>
                      void handleStatusUpdate(selectedDetail.id, "dismissed")
                    }
                  >
                    Dismiss
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busyIds.has(selectedDetail.id)}
                    onClick={() =>
                      void handleStatusUpdate(selectedDetail.id, "rejected")
                    }
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
