import { lazy, Suspense, useMemo } from "react";
import { RotateCw, SlidersHorizontal } from "lucide-react";
import type { ChatTimelineItem } from "../../features/chat/chat-adapters";
import type { ExtractedParameter } from "../../api/query.api";
import { fileExtension } from "./utils";
import { Button } from "../ui/button";
import { EmptyState } from "../layout/EmptyState";
import { InlineAlert } from "../layout/InlineAlert";
import { DownloadPillGroup } from "./DownloadPill";
import { ParameterSliderGroup } from "./ParameterSlider";

const LazyModelViewer = lazy(async () => {
  const module = await import("../ModelViewer");
  return { default: module.ModelViewer };
});

export interface WorkbenchPaneProps {
  selectedAssistantItem: ChatTimelineItem | null;
  selectedAssistantFiles: Array<{ path: string; filename: string }>;
  selectedPreviewFile: { path: string; filename: string } | null;
  busyAction: string | null;
  token: string | null;
  parameters: ExtractedParameter[];
  tweakedValues: Record<string, number>;
  parametersLoading: boolean;
  reRenderBusy: boolean;
  onParameterChange: (name: string, value: number) => void;
  onReRender: () => void;
  onDownloadFile: (filePath: string) => void;
}

export function WorkbenchPane({
  selectedAssistantItem,
  selectedAssistantFiles,
  selectedPreviewFile,
  busyAction,
  token,
  parameters,
  tweakedValues,
  parametersLoading,
  reRenderBusy,
  onParameterChange,
  onReRender,
  onDownloadFile,
}: WorkbenchPaneProps) {
  const hasChanges = useMemo(() => {
    return parameters.some((p) => {
      const tweaked = tweakedValues[p.name];
      return tweaked !== undefined && tweaked !== p.value;
    });
  }, [parameters, tweakedValues]);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">3D Workbench</h3>
      </div>

      {/* Model Preview */}
      <div>
        {!selectedPreviewFile ? (
          <EmptyState
            title="No preview file yet"
            description="Generate a response to inspect geometry previews and file outputs."
          />
        ) : [".stl", ".3mf"].includes(fileExtension(selectedPreviewFile.path)) ? (
          <Suspense fallback={<p className="text-sm text-[hsl(var(--muted-foreground))]">Loading 3D viewer...</p>}>
            <LazyModelViewer token={token ?? ""} filePath={selectedPreviewFile.path} />
          </Suspense>
        ) : (
          <InlineAlert tone="warning">
            Preview is limited for STEP-only output. Download STEP or regenerate with STL/3MF preference.
          </InlineAlert>
        )}
      </div>

      {/* Download Pills */}
      {selectedAssistantFiles.length > 0 ? (
        <DownloadPillGroup
          files={selectedAssistantFiles}
          onDownload={onDownloadFile}
          loadingFilePath={busyAction?.startsWith("download-") ? busyAction.slice(9) : null}
          disabled={busyAction !== null}
        />
      ) : null}

      {/* Parameters Section */}
      {parametersLoading ? (
        <div className="space-y-2 pt-2 border-t border-[hsl(var(--border)_/_0.5)]">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
            <h4 className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Parameters</h4>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading parameters...</p>
        </div>
      ) : parameters.length > 0 ? (
        <div className="space-y-3 pt-2 border-t border-[hsl(var(--border)_/_0.5)]">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
            <h4 className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Parameters</h4>
          </div>

          <ParameterSliderGroup
            parameters={parameters}
            tweakedValues={tweakedValues}
            onChange={onParameterChange}
          />

          <Button
            size="sm"
            variant={hasChanges ? "default" : "outline"}
            iconLeft={<RotateCw className="h-3.5 w-3.5" />}
            loading={reRenderBusy}
            disabled={!hasChanges || reRenderBusy || busyAction !== null}
            onClick={onReRender}
          >
            Re-render
          </Button>
        </div>
      ) : selectedAssistantItem ? (
        <div className="space-y-2 pt-2 border-t border-[hsl(var(--border)_/_0.5)]">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
            <h4 className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Parameters</h4>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">No tweakable parameters found in this model.</p>
        </div>
      ) : null}
    </div>
  );
}
