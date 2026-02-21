import { useRef } from "react";
import {
  Image as ImageIcon,
  File as FileIcon,
  Paperclip,
  RefreshCw,
  Send,
  Upload,
  X,
} from "lucide-react";
import type { QueryAttachment } from "../../api/query.api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export interface PromptComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  queuedAttachments: QueryAttachment[];
  busyAction: string | null;
  hasAssistantItems: boolean;
  activeContextId: string | null;
  onSubmit: () => void;
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (path: string) => void;
  onRegenerate: () => void;
}

export function PromptComposer({
  prompt,
  onPromptChange,
  queuedAttachments,
  busyAction,
  hasAssistantItems,
  activeContextId,
  onSubmit,
  onAttachFiles,
  onRemoveAttachment,
  onRegenerate,
}: PromptComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-2 rounded-lg border border-[hsl(var(--border)_/_0.5)] bg-[hsl(var(--surface-2))] p-3">
      {/* Hidden file input — triggered by Paperclip button */}
      <input
        ref={fileInputRef}
        id="chat-attachments"
        data-testid="chat-attachments-input"
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          const nextFiles = event.target.files ? [...event.target.files] : [];
          if (nextFiles.length > 0) {
            onAttachFiles(nextFiles);
          }
        }}
      />

      {/* Queued attachments — compact pills */}
      {queuedAttachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {queuedAttachments.map((attachment) => (
            <span
              key={attachment.path}
              className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2.5 py-1 text-xs"
            >
              {attachment.kind === "image" ? (
                <ImageIcon className="h-3 w-3 text-[hsl(var(--info))]" />
              ) : (
                <FileIcon className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
              )}
              <span className="max-w-[120px] truncate">{attachment.filename}</span>
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                onClick={() => onRemoveAttachment(attachment.path)}
                aria-label={`Remove ${attachment.filename}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Pending upload indicator */}
      {busyAction === "upload-attachments" ? (
        <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Upload className="h-3 w-3 animate-pulse" />
          Uploading files...
        </p>
      ) : null}

      <Textarea
        id="chat-prompt"
        data-testid="chat-prompt-input"
        placeholder="Describe the part, dimensions, and constraints..."
        value={prompt}
        rows={3}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Attach files"
            disabled={busyAction === "upload-attachments"}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          {activeContextId && hasAssistantItems ? (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
              disabled={busyAction !== null}
              onClick={onRegenerate}
            >
              Regenerate
            </Button>
          ) : null}
        </div>
        <Button
          iconLeft={<Send className="h-4 w-4" />}
          loading={busyAction === "submit-prompt"}
          disabled={busyAction !== null || prompt.trim() === ""}
          onClick={onSubmit}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
