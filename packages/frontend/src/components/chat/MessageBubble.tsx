import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Download, RefreshCw, ThumbsDown, ThumbsUp, User } from "lucide-react";
import type { ChatTimelineItem } from "../../features/chat/chat-adapters";
import { Button } from "../ui/button";
import { fileExtension, formatEstimatedCostUsd, uniqueFilesByPath } from "./utils";

export interface MessageBubbleProps {
  item: ChatTimelineItem;
  isSelected: boolean;
  busyAction: string | null;
  onSelect: (itemId: string) => void;
  onRate: (item: { id: string; rating: -1 | 0 | 1 }, rating: -1 | 1) => void;
  onRegenerate: (assistantItemId: string) => void;
  onDownloadFile: (filePath: string) => void;
}

const extensionLabels = [
  { extension: ".step", label: "STEP" },
  { extension: ".stp", label: "STP" },
  { extension: ".stl", label: "STL" },
  { extension: ".3mf", label: "3MF" },
  { extension: ".b123d", label: "B123D" },
];

export function MessageBubble({
  item,
  isSelected,
  busyAction,
  onSelect,
  onRate,
  onRegenerate,
  onDownloadFile,
}: MessageBubbleProps) {
  const allFiles = uniqueFilesByPath(item.segments.flatMap((segment) => segment.files));

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
        {item.segments.map((segment) => {
          const isAttachment = segment.kind === "attachment";

          return (
            <div
              key={segment.id}
              className={`rounded-md px-1 ${
                segment.kind === "error"
                  ? "border border-[hsl(var(--destructive))] p-2 text-[hsl(var(--destructive))]"
                  : ""
              }`}
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

              {segment.kind === "meta" && segment.usage ? (
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  Usage: {segment.usage.inputTokens} in / {segment.usage.outputTokens} out / {segment.usage.totalTokens} total ·
                  est. ${formatEstimatedCostUsd(segment.usage.estimatedCostUsd)}
                </p>
              ) : null}

              {segment.kind === "meta" && segment.artifact ? (
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  Artifacts: {segment.artifact.previewStatus} · {segment.artifact.detail}
                </p>
              ) : null}

              {segment.files.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {segment.files.map((file) => (
                    <li key={`${segment.id}-${file.path}`}>{file.filename}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {item.role === "assistant" && allFiles.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md bg-[hsl(var(--surface-2)_/_0.6)] p-2">
          <Download className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
          {extensionLabels.map((entry) => {
            const matched = allFiles.find((file) => fileExtension(file.path) === entry.extension);
            return (
              <Button
                key={`${item.id}-${entry.extension}`}
                size="sm"
                variant="outline"
                disabled={!matched || busyAction !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  if (matched) {
                    onDownloadFile(matched.path);
                  }
                }}
              >
                {entry.label}
              </Button>
            );
          })}
        </div>
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
