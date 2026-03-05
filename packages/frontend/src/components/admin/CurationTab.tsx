import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Star, ThumbsDown, X } from "lucide-react";
import {
  listCurationCandidates,
  getCurationCandidateDetail,
  updateCurationCandidate,
  type CurationCandidateRow,
  type CurationCandidateDetail,
  type CurationStatus,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Drawer } from "../ui/drawer";

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
 * Looks for previews array entries with type "screenshot".
 */
function extractScreenshotPath(messages: unknown[]): string | null {
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;

    if (Array.isArray(m.previews)) {
      // Prefer ISO angle
      for (const preview of m.previews) {
        if (typeof preview !== "object" || preview === null) continue;
        const p = preview as Record<string, unknown>;
        if (p.type === "screenshot" && typeof p.path === "string" && p.angle === "iso") {
          return p.path as string;
        }
      }
      // Fallback: first screenshot
      for (const preview of m.previews) {
        if (typeof preview !== "object" || preview === null) continue;
        const p = preview as Record<string, unknown>;
        if (p.type === "screenshot" && typeof p.path === "string") {
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

/**
 * Extract first user message text from conversation items.
 */
function extractFirstUserPrompt(
  items: Array<{ role: string; messages: unknown[] }>,
): string {
  for (const item of items) {
    if (item.role === "user") {
      return extractText(item.messages as unknown[]);
    }
  }
  return "(no user message)";
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
                      <img
                        src={`/api/files/download?path=${encodeURIComponent(screenshotPath)}`}
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
                <img
                  src={`/api/files/download?path=${encodeURIComponent(path)}`}
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

            {/* Context info */}
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Chat: {selectedDetail.chatContext.name}
                {selectedDetail.chatContext.deletedAt ? " (soft-deleted)" : ""}
              </p>
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
              <div className="flex gap-2 border-t border-[hsl(var(--border))] pt-3">
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
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
