import { Download } from "lucide-react";
import { cn } from "../../lib/cn";
import { Spinner } from "../ui/spinner";
import { fileExtension } from "./utils";

/* ------------------------------------------------------------------ */
/*  DownloadPill                                                       */
/* ------------------------------------------------------------------ */

export interface DownloadPillProps {
  /** Format label displayed on the pill (e.g. "STL", "STEP"). */
  label: string;
  /** Server file path used to initiate the download. */
  filePath: string;
  /** Callback invoked with `filePath` when the pill is clicked. */
  onDownload: (filePath: string) => void;
  /** Show a loading spinner instead of the download icon. */
  isLoading?: boolean;
  /** Disable the pill (e.g. while another action is in progress). */
  disabled?: boolean;
}

/**
 * Compact inline pill button for downloading a single generated file.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export function DownloadPill({
  label,
  filePath,
  onDownload,
  isLoading = false,
  disabled = false,
}: DownloadPillProps) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      aria-label={`Download ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onDownload(filePath);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        "border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))]",
        "hover:bg-[hsl(var(--muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      {isLoading ? (
        <Spinner size="sm" label={`Downloading ${label}`} className="h-3 w-3" />
      ) : (
        <Download className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  DownloadPillGroup                                                  */
/* ------------------------------------------------------------------ */

/** Map of file extensions to human-readable format labels. */
const FORMAT_LABELS: Record<string, string> = {
  ".stl": "STL",
  ".step": "STEP",
  ".stp": "STEP",
  ".3mf": "3MF",
  ".b123d": "B123D",
};

export interface DownloadableFile {
  path: string;
  filename: string;
}

export interface DownloadPillGroupProps {
  /** List of downloadable files for this assistant response. */
  files: DownloadableFile[];
  /** Callback invoked with the file path when a pill is clicked. */
  onDownload: (filePath: string) => void;
  /** File path currently being downloaded (shows loading state on that pill). */
  loadingFilePath?: string | null;
  /** Disable all pills (e.g. while another action is in progress). */
  disabled?: boolean;
}

/**
 * Renders a row of {@link DownloadPill} elements for each downloadable file.
 * Returns `null` when the file list is empty — the section is omitted entirely
 * per Requirement 5.5.
 */
export function DownloadPillGroup({
  files,
  onDownload,
  loadingFilePath = null,
  disabled = false,
}: DownloadPillGroupProps) {
  const pills = files
    .map((file) => {
      const ext = fileExtension(file.path);
      const label = FORMAT_LABELS[ext];
      if (!label) return null;
      return { file, label };
    })
    .filter(Boolean) as Array<{ file: DownloadableFile; label: string }>;

  if (pills.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="download-pill-group">
      {pills.map(({ file, label }) => (
        <DownloadPill
          key={file.path}
          label={label}
          filePath={file.path}
          onDownload={onDownload}
          isLoading={loadingFilePath === file.path}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
