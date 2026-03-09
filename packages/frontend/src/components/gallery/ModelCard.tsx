import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, GitBranch, Lock, Star } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  getGalleryScreenshotUrl,
  getGalleryDownloadUrl,
  remixModel,
  downloadProtectedFile,
  type GalleryModelSummary,
} from "../../api/gallery.api";
import { useAuth } from "../../hooks/useAuth";
import { useChatContextsContext } from "../../contexts/ChatContextsContext";

interface ModelCardProps {
  model: GalleryModelSummary;
}

export function ModelCard({ model }: ModelCardProps) {
  const { token, isAuthenticated } = useAuth();
  const { refreshContexts } = useChatContextsContext();
  const navigate = useNavigate();
  const [remixing, setRemixing] = useState(false);

  const screenshotUrl = getGalleryScreenshotUrl(model.id);

  async function handleRemix() {
    if (!isAuthenticated || !token) {
      navigate(`/login?redirect=${encodeURIComponent("/gallery")}&remixId=${encodeURIComponent(model.id)}`);
      return;
    }
    setRemixing(true);
    try {
      const { contextId } = await remixModel(token, model.id);
      await refreshContexts();
      navigate(`/chat/${contextId}`);
    } catch {
      setRemixing(false);
    }
  }

  async function handleProtectedDownload(format: string) {
    if (!isAuthenticated || !token) {
      navigate(`/login?redirect=${encodeURIComponent(`/gallery`)}`);
      return;
    }
    try {
      const blob = await downloadProtectedFile(token, model.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `model.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Download failed silently
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition hover:shadow-md">
      <div className="relative aspect-square bg-[hsl(var(--muted))] overflow-hidden">
        <img
          src={screenshotUrl}
          alt={model.promptText}
          className="h-full w-full object-contain"
          loading="lazy"
        />
        {model.evalScore != null && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            {model.evalScore}/10
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <p className="text-sm text-[hsl(var(--foreground))] line-clamp-2">
          {model.promptText}
        </p>
        <Badge tone="neutral" className="self-start">{model.categoryName}</Badge>

        {/* Download buttons */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <a
            href={getGalleryDownloadUrl(model.id, "stl")}
            download
            className="inline-flex h-9 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2.5 text-xs text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] sm:h-7 sm:px-2"
          >
            <Download className="h-3 w-3" /> STL
          </a>
          <a
            href={getGalleryDownloadUrl(model.id, "3mf")}
            download
            className="inline-flex h-9 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2.5 text-xs text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] sm:h-7 sm:px-2"
          >
            <Download className="h-3 w-3" /> 3MF
          </a>
          <button
            type="button"
            onClick={() => handleProtectedDownload("step")}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2.5 text-xs text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] sm:h-7 sm:px-2"
            title={isAuthenticated ? "Download STEP" : "Login required"}
          >
            {isAuthenticated ? <Download className="h-3 w-3" /> : <Lock className="h-3 w-3" />} STEP
          </button>
          <button
            type="button"
            onClick={() => handleProtectedDownload("b123d")}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2.5 text-xs text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] sm:h-7 sm:px-2"
            title={isAuthenticated ? "Download Source" : "Login required"}
          >
            {isAuthenticated ? <Download className="h-3 w-3" /> : <Lock className="h-3 w-3" />} B123D
          </button>
        </div>

        {/* Remix button */}
        <Button
          variant="default"
          size="sm"
          loading={remixing}
          iconLeft={isAuthenticated ? <GitBranch className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          onClick={handleRemix}
          className="mt-auto"
        >
          {isAuthenticated ? "Remix" : "Login to Remix"}
        </Button>
      </div>
    </div>
  );
}
