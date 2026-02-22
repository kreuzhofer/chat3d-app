import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Bot, MessageCircleWarning, RefreshCw, ThumbsDown, ThumbsUp, User } from "lucide-react";
import type { ChatTimelineItem } from "../../features/chat/chat-adapters";
import { Button } from "../ui/button";
import { InlineModelViewer } from "./InlineModelViewer";
import { CollapsibleSection } from "./CollapsibleSection";
import { DownloadPillGroup } from "./DownloadPill";
import { fileExtension, formatEstimatedCostUsd, uniqueFilesByPath } from "./utils";

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
  onSelect: (itemId: string) => void;
  onRate: (item: { id: string; rating: -1 | 0 | 1 }, rating: -1 | 1) => void;
  onRegenerate: (assistantItemId: string) => void;
  onDownloadFile: (filePath: string) => void;
}

export function MessageBubble({
  item,
  isSelected,
  busyAction,
  token,
  streamingText,
  streamingError,
  isStreaming,
  onSelect,
  onRate,
  onRegenerate,
  onDownloadFile,
}: MessageBubbleProps) {
  const allFiles = uniqueFilesByPath(item.segments.flatMap((segment) => segment.files));
  const hasStreamingContent = isStreaming && typeof streamingText === "string" && streamingText.length > 0;

  // Find the first preview-ready file (.stl or .3mf) for inline 3D preview
  const previewFile = item.role === "assistant" && !isStreaming
    ? allFiles.find((f) => {
        const ext = fileExtension(f.path);
        return ext === ".stl" || ext === ".3mf";
      })
    : undefined;

  return (
    <article
      className={`animate-fade-in rounded-lg border p-3.5 transition ${
        item.role === "user"
          ? "border-transparent bg-[hsl(var(--surface-2)_/_0.6)]"
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
          <span className="font-semibold uppercase tracking-wide">{item.role}</span>
        </div>
        <span>{new Date(item.createdAt).toLocaleString()}</span>
      </div>

      <div className="space-y-1.5">
        {/* When streaming is active, show streaming text as plain text (incremental append) */}
        {hasStreamingContent ? (
          <div className="rounded-md px-1" data-testid="streaming-content">
            <p className="whitespace-pre-wrap text-sm">{streamingText}</p>
          </div>
        ) : null}

        {/* When stream is interrupted, show partial text + inline error */}
        {!isStreaming && streamingError && streamingText ? (
          <>
            <div className="rounded-md px-1" data-testid="streaming-partial-content">
              <p className="whitespace-pre-wrap text-sm">{streamingText}</p>
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
              const isAttachment = segment.kind === "attachment";
              const isMeta = segment.kind === "meta";
              const hasFiles = segment.files.length > 0;

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
                      <span>Something went wrong while generating your model</span>
                    </div>
                    {segment.text ? (
                      <p className="mb-2 rounded-md bg-[hsl(var(--warning)_/_0.06)] px-2.5 py-1.5 font-mono text-xs text-[hsl(var(--muted-foreground))]" data-testid="error-detail">
                        {segment.text}
                      </p>
                    ) : null}
                    <p className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="error-suggestion">
                      Try rephrasing your request or ask me to use a different approach.
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
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        {segment.text || `${segment.attachmentKind === "image" ? "Image" : "File"} attachment`}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {segment.attachmentFilename || segment.attachmentPath}
                        {segment.attachmentMimeType ? ` · ${segment.attachmentMimeType}` : ""}
                      </p>
                      {segment.attachmentPath ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyAction !== null}
                          onClick={() => {
                            onDownloadFile(segment.attachmentPath);
                          }}
                        >
                          Download Attachment
                        </Button>
                      ) : null}
                    </div>
                  ) : segment.text ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment.text}</ReactMarkdown>
                  ) : (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">(empty)</p>
                  )}

                  {/* Meta details wrapped in CollapsibleSection for progressive disclosure */}
                  {isMeta && (segment.usage || segment.artifact) ? (
                    <CollapsibleSection title="Details" defaultExpanded={false}>
                      {segment.usage ? (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          Usage: {segment.usage.inputTokens} in / {segment.usage.outputTokens} out / {segment.usage.totalTokens} total ·
                          est. ${formatEstimatedCostUsd(segment.usage.estimatedCostUsd)}
                        </p>
                      ) : null}
                      {segment.artifact ? (
                        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                          Artifacts: {segment.artifact.previewStatus} · {segment.artifact.detail}
                        </p>
                      ) : null}
                    </CollapsibleSection>
                  ) : null}

                  {/* File list wrapped in CollapsibleSection for progressive disclosure */}
                  {hasFiles ? (
                    <div className="mt-2">
                      <CollapsibleSection title="Files" defaultExpanded={false}>
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
        <div className="mt-3" data-testid="inline-model-viewer">
          <InlineModelViewer filePath={previewFile.path} token={token} />
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

      {item.role === "assistant" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={item.rating === 1 ? "default" : "ghost"}
            iconLeft={<ThumbsUp className={`h-3.5 w-3.5 ${item.rating === 1 ? "" : "text-[hsl(var(--muted-foreground))]"}`} />}
            aria-label="Thumbs up"
            disabled={busyAction !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRate(item, 1);
            }}
          >
            {item.rating === 1 ? "Liked" : ""}
          </Button>
          <Button
            size="sm"
            variant={item.rating === -1 ? "destructive" : "ghost"}
            iconLeft={<ThumbsDown className={`h-3.5 w-3.5 ${item.rating === -1 ? "" : "text-[hsl(var(--muted-foreground))]"}`} />}
            aria-label="Thumbs down"
            disabled={busyAction !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRate(item, -1);
            }}
          >
            {item.rating === -1 ? "Disliked" : ""}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
            disabled={busyAction !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRegenerate(item.id);
            }}
          >
            Regenerate
          </Button>
        </div>
      ) : null}
    </article>
  );
}
