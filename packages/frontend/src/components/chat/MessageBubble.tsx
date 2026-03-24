import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bot, Loader2, MessageCircleWarning, RefreshCw, ThumbsDown, ThumbsUp, Undo2, User } from "lucide-react";
import type { ChatTimelineItem } from "../../features/chat/chat-adapters";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { InlineModelViewer } from "./InlineModelViewer";
import { CollapsibleSection } from "./CollapsibleSection";
import { DownloadPillGroup } from "./DownloadPill";
import { InlineImagePreview, InlinePipelineProgress } from "./MessageBubbleHelpers";
import { SuggestionPills } from "./SuggestionPills";
import { fileExtension, formatEstimatedCostUsd, uniqueFilesByPath } from "./utils";
import { useLazyVisible } from "../../hooks/useLazyVisible";

export interface MessageBubbleProps {
  item: ChatTimelineItem;
  isSelected: boolean;
  busyAction: string | null;
  /** Auth token passed to InlineModelViewer for fetching 3D model files. */
  token: string | null;
  /** Streaming text for the in-progress assistant response (incremental append). */
  streamingText?: string;
  /** Error message when the stream was interrupted. */
  streamingError?: string | null;
  /** Whether streaming is currently active for this message. */
  isStreaming?: boolean;
  /** Live pipeline progress detail from SSE (e.g. "Thinking... (5000 chars)"). */
  queryStateDetail?: string | null;
  /** Whether the pipeline has been running for a long time. */
  isLongRunning?: boolean;
  /** Whether to show "Enable notifications" button. */
  showEnableNotifications?: boolean;
  /** Whether the notification enable action is busy. */
  busyNotifications?: boolean;
  /** Called when user clicks "Enable notifications". */
  onEnableNotifications?: () => void;
  /** Whether the current user is an admin (controls cost visibility). */
  isAdmin?: boolean;
  /** True only for the most recent assistant item — controls regenerate visibility. */
  isLatestAssistant?: boolean;
  /** True when any pipeline is actively running (disables regenerate). */
  isPipelineActive?: boolean;
  onSelect: (itemId: string) => void;
  onRate: (item: { id: string; rating: -1 | 0 | 1 }, rating: -1 | 1) => void;
  onRegenerate: (assistantItemId: string) => void;
  onRevertTo: (assistantItemId: string) => void;
  onDownloadFile: (filePath: string) => void;
  onSelectSuggestion?: (prompt: string) => void;
  /** Whether the initial scroll-to-bottom has settled (gates lazy 3D viewer loading). */
  scrollSettled?: boolean;
}

export function MessageBubble({
  item,
  isSelected,
  busyAction,
  token,
  streamingText,
  streamingError,
  isStreaming,
  queryStateDetail,
  isLongRunning,
  showEnableNotifications,
  busyNotifications,
  onEnableNotifications,
  isAdmin,
  isLatestAssistant,
  isPipelineActive,
  onSelect,
  onRate,
  onRegenerate,
  onRevertTo,
  onDownloadFile,
  onSelectSuggestion,
  scrollSettled,
}: MessageBubbleProps) {
  const { t } = useTranslation(["pages", "common"]);
  const allFiles = uniqueFilesByPath(item.segments.flatMap((segment) => segment.files));
  const hasStreamingContent = isStreaming && typeof streamingText === "string" && streamingText.length > 0;

  // Lazy-load 3D viewer only when visible and after initial scroll has settled
  const [viewerRef, viewerVisible] = useLazyVisible<HTMLDivElement>(scrollSettled ?? true);

  // Find the best preview-ready file for inline 3D preview.
  // Prefer .3mf (richer format, can carry materials), fall back to .stl.
  // Show as soon as files exist — don't wait for the pipeline to finish, since
  // rendering completes before evaluation/fixing phases.
  const previewFile = item.role === "assistant"
    ? (allFiles.find((f) => fileExtension(f.path) === ".3mf") ??
       allFiles.find((f) => fileExtension(f.path) === ".stl"))
    : undefined;

  // Aggregate usage across all meta segments for inline cost tag
  const totalUsage = (() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let found = false;
    for (const seg of item.segments) {
      if (seg.usage) {
        inputTokens += seg.usage.inputTokens;
        outputTokens += seg.usage.outputTokens;
        reasoningTokens += seg.usage.reasoningTokens;
        totalTokens += seg.usage.totalTokens;
        estimatedCostUsd += seg.usage.estimatedCostUsd;
        found = true;
      }
    }
    return found ? { inputTokens, outputTokens, reasoningTokens, totalTokens, estimatedCostUsd } : null;
  })();

  return (
    <div className={item.role === "user" ? "pl-[15%]" : "pr-[15%]"}>
    <article
      className={`animate-fade-in rounded-lg border p-3.5 transition ${
        item.role === "user"
          ? "border-transparent bg-[hsl(var(--primary)_/_0.08)]"
          : isSelected
            ? "border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.04)] shadow-sm"
            : "border-[hsl(var(--border)_/_0.4)] bg-[hsl(var(--surface-1))] hover:border-[hsl(var(--primary)_/_0.3)]"
      } ${item.role === "assistant" ? "cursor-pointer" : ""}`}
      onClick={() => {
        if (item.role === "assistant") {
          onSelect(item.id);
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
        <div className="flex items-center gap-2">
          {item.role === "user" ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
              <User className="h-3.5 w-3.5" />
            </span>
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]">
              <Bot className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="font-semibold uppercase tracking-wide">{t(`common:labels.${item.role}`)}</span>
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--primary))]" />
          ) : null}
        </div>
        <span>{new Date(item.createdAt).toLocaleString()}</span>
      </div>

      <div className="msg-content space-y-1.5 overflow-hidden">
        {/* When streaming is active, render streaming text with markdown (incremental append) */}
        {hasStreamingContent ? (
          <>
            <div className="rounded-md px-1" data-testid="streaming-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
            </div>
            {queryStateDetail ? (
              <InlinePipelineProgress
                detail={queryStateDetail}
                isLongRunning={isLongRunning}
                showEnableNotifications={showEnableNotifications}
                busyNotifications={busyNotifications}
                onEnableNotifications={onEnableNotifications}
              />
            ) : null}
          </>
        ) : null}

        {/* When stream is interrupted, show partial text + inline error */}
        {!isStreaming && streamingError && streamingText ? (
          <>
            <div className="rounded-md px-1" data-testid="streaming-partial-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
            </div>
            <div
              className="flex items-center gap-2 rounded-md border border-[hsl(var(--warning)_/_0.5)] bg-[hsl(var(--warning)_/_0.08)] px-2 py-1.5 text-sm text-[hsl(var(--warning-foreground,var(--foreground)))]"
              data-testid="streaming-error"
              role="alert"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
              <span>{streamingError}</span>
            </div>
          </>
        ) : null}

        {/* Normal segment rendering — shown when not actively streaming */}
        {!hasStreamingContent && !(streamingError && streamingText) ? (
          <>
            {item.segments.map((segment) => {
              // "code" segments are stored for machine use (conversation history, workbench routing), not for display
              if (segment.kind === "code") return null;

              const isAttachment = segment.kind === "attachment";
              const isMeta = segment.kind === "meta";
              const hasFiles = segment.files.length > 0;

              // Meta segments (generation diagnostics) are admin-only
              if (isMeta && !isAdmin) return null;

              if (segment.kind === "error") {
                return (
                  <div
                    key={segment.id}
                    className="rounded-lg border border-[hsl(var(--warning)_/_0.5)] bg-[hsl(var(--warning)_/_0.06)] p-3"
                    data-testid="conversational-error"
                    role="alert"
                  >
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[hsl(var(--warning-foreground,var(--foreground)))]">
                      <MessageCircleWarning className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" />
                      <span>{t("pages:chat.error.generationTitle")}</span>
                    </div>
                    {segment.text ? (
                      <p className="mb-2 rounded-md bg-[hsl(var(--warning)_/_0.06)] px-2.5 py-1.5 font-mono text-xs text-[hsl(var(--muted-foreground))]" data-testid="error-detail">
                        {segment.text}
                      </p>
                    ) : null}
                    <p className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="error-suggestion">
                      {t("pages:chat.error.generationSuggestion")}
                    </p>
                  </div>
                );
              }

              return (
                <div
                  key={segment.id}
                  className="rounded-md px-1"
                >
                  {isAttachment ? (
                    <div className="space-y-1.5">
                      {segment.attachmentKind === "image" && segment.attachmentPath && token ? (
                        <InlineImagePreview filePath={segment.attachmentPath} token={token} />
                      ) : (
                        <p className="text-sm font-medium">
                          {segment.text || t("pages:chat.fileAttachment")}
                        </p>
                      )}
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {segment.attachmentFilename || segment.attachmentPath}
                      </p>
                    </div>
                  ) : segment.text ? (
                    <>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment.text}</ReactMarkdown>
                      {/* Inline progress indicator for pending segments (pipeline still running) */}
                      {segment.state === "pending" && (queryStateDetail || segment.stateMessage) ? (
                        <InlinePipelineProgress
                          detail={queryStateDetail || segment.stateMessage!}
                          isLongRunning={isLongRunning}
                          showEnableNotifications={showEnableNotifications}
                          busyNotifications={busyNotifications}
                          onEnableNotifications={onEnableNotifications}
                        />
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:chat.empty")}</p>
                  )}

                  {/* Suggestion pills for clarification responses */}
                  {segment.kind === "suggestions" && segment.suggestions.length > 0 && onSelectSuggestion ? (
                    <SuggestionPills
                      suggestions={segment.suggestions}
                      onSelectSuggestion={onSelectSuggestion}
                    />
                  ) : null}

                  {/* Meta details wrapped in CollapsibleSection for progressive disclosure (admin only) */}
                  {isAdmin && isMeta && (segment.usage || segment.artifact) ? (
                    <CollapsibleSection title={t("common:labels.details")} defaultExpanded={false}>
                      {segment.usage ? (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          Usage: {segment.usage.inputTokens} in / {segment.usage.outputTokens} out{segment.usage.reasoningTokens > 0 ? ` / ${segment.usage.reasoningTokens} thinking` : ""} / {segment.usage.totalTokens} total ·
                          est. ${formatEstimatedCostUsd(segment.usage.estimatedCostUsd)}
                          {segment.usage.durationMs != null && segment.usage.durationMs > 0 ? (
                            <> · {(segment.usage.durationMs / 1000).toFixed(1)}s · {(segment.usage.outputTokens / (segment.usage.durationMs / 1000)).toFixed(1)} tok/s</>
                          ) : null}
                        </p>
                      ) : null}
                      {segment.artifact ? (
                        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                          Artifacts: {segment.artifact.previewStatus} · {segment.artifact.detail}
                        </p>
                      ) : null}
                    </CollapsibleSection>
                  ) : null}

                  {/* File list wrapped in CollapsibleSection for progressive disclosure (admin only) */}
                  {isAdmin && hasFiles && item.role === "assistant" ? (
                    <div className="mt-2">
                      <CollapsibleSection title={t("common:labels.files")} defaultExpanded={false}>
                        <ul className="list-disc pl-5 text-sm">
                          {segment.files.map((file) => (
                            <li key={`${segment.id}-${file.path}`}>{file.filename}</li>
                          ))}
                        </ul>
                      </CollapsibleSection>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : null}
      </div>

      {previewFile && token ? (
        <div ref={viewerRef} className="mt-3" data-testid="inline-model-viewer">
          {viewerVisible ? (
            <InlineModelViewer filePath={previewFile.path} token={token} />
          ) : (
            <div className="inline-model-viewer w-full max-w-[400px] overflow-hidden rounded-lg border border-[hsl(var(--border))]">
              <div className="space-y-2 p-3">
                <Skeleton className="h-[240px] w-full rounded-md" />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Download pills replacing the old download bar */}
      {item.role === "assistant" ? (
        <DownloadPillGroup
          files={allFiles}
          onDownload={onDownloadFile}
          disabled={busyAction !== null}
        />
      ) : null}

      {/* Inline cost tag (admin only) */}
      {isAdmin && item.role === "assistant" && totalUsage && totalUsage.totalTokens > 0 ? (
        <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground)_/_0.6)]">
          {totalUsage.totalTokens.toLocaleString()} tokens · ~${formatEstimatedCostUsd(totalUsage.estimatedCostUsd)}
        </p>
      ) : null}

      {item.role === "assistant" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={item.rating === 1 ? "default" : "ghost"}
            iconLeft={<ThumbsUp className={`h-3.5 w-3.5 ${item.rating === 1 ? "" : "text-[hsl(var(--muted-foreground))]"}`} />}
            aria-label={t("common:a11y.thumbsUp")}
            disabled={busyAction !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRate(item, 1);
            }}
          >
            {item.rating === 1 ? t("common:status.liked") : ""}
          </Button>
          <Button
            size="sm"
            variant={item.rating === -1 ? "destructive" : "ghost"}
            iconLeft={<ThumbsDown className={`h-3.5 w-3.5 ${item.rating === -1 ? "" : "text-[hsl(var(--muted-foreground))]"}`} />}
            aria-label={t("common:a11y.thumbsDown")}
            disabled={busyAction !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRate(item, -1);
            }}
          >
            {item.rating === -1 ? t("common:status.disliked") : ""}
          </Button>
          {isLatestAssistant ? (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
              disabled={busyAction !== null || isPipelineActive}
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate(item.id);
              }}
            >
              {t("common:actions.regenerate")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Undo2 className="h-3.5 w-3.5" />}
              disabled={busyAction !== null || isPipelineActive}
              onClick={(e) => {
                e.stopPropagation();
                onRevertTo(item.id);
              }}
            >
              {t("common:actions.revertTo")}
            </Button>
          )}
        </div>
      ) : null}
    </article>
    </div>
  );
}
