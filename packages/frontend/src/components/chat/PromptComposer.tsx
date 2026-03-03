import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Image as ImageIcon,
  File as FileIcon,
  Loader2,
  Paperclip,
  Send,
  Square,
  AlertCircle,
  X,
} from "lucide-react";
import type { PendingFile } from "../../api/query.api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { CapabilityHints } from "./CapabilityHints";

export interface PromptComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  pendingFiles: PendingFile[];
  busyAction: string | null;
  activeContextId: string | null;
  /** When true, the send button is disabled to prevent concurrent submissions. */
  isStreaming?: boolean;
  onSubmit: () => void;
  onStop?: () => void;
  onAttachFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
}

export function PromptComposer({
  prompt,
  onPromptChange,
  pendingFiles,
  busyAction,
  activeContextId,
  isStreaming = false,
  onSubmit,
  onStop,
  onAttachFiles,
  onRemoveFile,
}: PromptComposerProps) {
  const { t } = useTranslation(["pages", "common"]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasUploading = pendingFiles.some((f) => f.status === "uploading");

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
          // Reset value so re-selecting the same file triggers onChange again
          if (event.target) {
            event.target.value = "";
          }
        }}
      />

      {/* Pending file thumbnails / pills */}
      {pendingFiles.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pendingFiles.map((pending) => (
            <div key={pending.id} className="group relative">
              {pending.kind === "image" && pending.previewUrl ? (
                <div className="relative">
                  <img
                    src={pending.previewUrl}
                    alt={pending.file.name}
                    className="h-16 w-16 rounded-md border border-[hsl(var(--border))] object-cover"
                  />
                  {pending.status === "uploading" ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  ) : null}
                  {pending.status === "error" ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
                      <AlertCircle className="h-4 w-4 text-red-400" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))]">
                  {pending.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--muted-foreground))]" />
                  ) : pending.status === "error" ? (
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                  )}
                  <span className="max-w-[56px] truncate text-[9px] text-[hsl(var(--muted-foreground))]">
                    {pending.file.name}
                  </span>
                </div>
              )}
              {/* Remove button — always visible on hover */}
              <button
                type="button"
                className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-[hsl(var(--destructive))] p-0.5 text-white shadow-sm group-hover:block"
                onClick={() => onRemoveFile(pending.id)}
                aria-label={`Remove ${pending.file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Textarea
        id="chat-prompt"
        data-testid="chat-prompt-input"
        placeholder={t("pages:chat.promptPlaceholder")}
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
            aria-label={t("common:a11y.attachFiles")}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <CapabilityHints />
        </div>
        {isStreaming ? (
          <Button
            variant="destructive"
            iconLeft={<Square className="h-4 w-4" />}
            onClick={onStop}
          >
            {t("common:actions.stop")}
          </Button>
        ) : (
          <Button
            iconLeft={<Send className="h-4 w-4" />}
            loading={busyAction === "submit-prompt"}
            disabled={busyAction !== null || prompt.trim() === "" || hasUploading}
            onClick={onSubmit}
          >
            {t("common:actions.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
