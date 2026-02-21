import { lazy, Suspense, useState } from "react";
import { Download, FileText, Save } from "lucide-react";
import type { ChatTimelineItem } from "../../features/chat/chat-adapters";
import type { LlmModel } from "../../api/query.api";
import { fileExtension } from "./utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../layout/EmptyState";
import { FormField } from "../ui/form";
import { InlineAlert } from "../layout/InlineAlert";
import { Select } from "../ui/select";
import { Tabs, TabPanel } from "../ui/tabs";
import { Textarea } from "../ui/textarea";

const LazyModelViewer = lazy(async () => {
  const module = await import("../ModelViewer");
  return { default: module.ModelViewer };
});

type RightPaneTab = "preview" | "parameters" | "files" | "history";

export interface WorkbenchPaneProps {
  selectedAssistantItem: ChatTimelineItem | null;
  selectedAssistantFiles: Array<{ path: string; filename: string }>;
  selectedPreviewFile: { path: string; filename: string } | null;
  queryStates: Array<{ id: number; state: string; detail: string; createdAt: string }>;
  conversationModels: LlmModel[];
  codegenModels: LlmModel[];
  conversationModelId: string;
  codegenModelId: string;
  outputFormat: "stl" | "3mf" | "step";
  detailLevel: "low" | "medium" | "high";
  advancedPrompt: string;
  activeContextId: string | null;
  busyAction: string | null;
  token: string | null;
  onConversationModelChange: (id: string) => void;
  onCodegenModelChange: (id: string) => void;
  onOutputFormatChange: (format: "stl" | "3mf" | "step") => void;
  onDetailLevelChange: (level: "low" | "medium" | "high") => void;
  onAdvancedPromptChange: (value: string) => void;
  onSaveModelSelection: () => void;
  onDownloadFile: (filePath: string) => void;
}

const rightPaneTabs = [
  { id: "preview", label: "Preview" },
  { id: "parameters", label: "Parameters" },
  { id: "files", label: "Files" },
  { id: "history", label: "History" },
] as const;

export function WorkbenchPane({
  selectedAssistantItem,
  selectedAssistantFiles,
  selectedPreviewFile,
  queryStates,
  conversationModels,
  codegenModels,
  conversationModelId,
  codegenModelId,
  outputFormat,
  detailLevel,
  advancedPrompt,
  activeContextId,
  busyAction,
  token,
  onConversationModelChange,
  onCodegenModelChange,
  onOutputFormatChange,
  onDetailLevelChange,
  onAdvancedPromptChange,
  onSaveModelSelection,
  onDownloadFile,
}: WorkbenchPaneProps) {
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("preview");

  return (
    <div className="space-y-3 rounded-xl border bg-[hsl(var(--surface-1))] p-3 shadow-[var(--elevation-1)]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">3D Workbench</h3>
        <Badge tone={selectedAssistantItem ? "success" : "neutral"}>
          {selectedAssistantItem ? "assistant selected" : "awaiting output"}
        </Badge>
      </div>

      <Tabs
        tabs={rightPaneTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeTab={rightPaneTab}
        onChange={(tabId) => setRightPaneTab(tabId as RightPaneTab)}
        className="w-full"
      />

      <TabPanel hidden={rightPaneTab !== "preview"}>
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
      </TabPanel>

      <TabPanel hidden={rightPaneTab !== "parameters"}>
        <div className="space-y-3">
          <FormField
            label="Conversation model"
            htmlFor="conversation-model"
            helperText="Controls planning and conversational guidance."
          >
            <Select
              id="conversation-model"
              value={conversationModelId}
              onChange={(event) => onConversationModelChange(event.target.value)}
              options={[
                { value: "", label: "Default" },
                ...conversationModels.map((model) => ({
                  value: model.id,
                  label: `${model.provider} / ${model.modelName}`,
                })),
              ]}
            />
          </FormField>

          <FormField label="Codegen model" htmlFor="codegen-model" helperText="Used for Build123d code synthesis.">
            <Select
              id="codegen-model"
              value={codegenModelId}
              onChange={(event) => onCodegenModelChange(event.target.value)}
              options={[
                { value: "", label: "Default" },
                ...codegenModels.map((model) => ({
                  value: model.id,
                  label: `${model.provider} / ${model.modelName}`,
                })),
              ]}
            />
          </FormField>

          <FormField label="Preferred output format" htmlFor="output-format">
            <Select
              id="output-format"
              value={outputFormat}
              onChange={(event) => onOutputFormatChange(event.target.value as "stl" | "3mf" | "step")}
              options={[
                { value: "stl", label: "STL (preview-friendly)" },
                { value: "3mf", label: "3MF (preview-friendly)" },
                { value: "step", label: "STEP (CAD exchange)" },
              ]}
            />
          </FormField>

          <FormField label="Detail level" htmlFor="detail-level">
            <Select
              id="detail-level"
              value={detailLevel}
              onChange={(event) => onDetailLevelChange(event.target.value as "low" | "medium" | "high")}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
            />
          </FormField>

          <FormField
            label="Advanced prompt modifiers"
            htmlFor="advanced-modifier"
            helperText="Appended to each submission as additional constraints."
          >
            <Textarea
              id="advanced-modifier"
              value={advancedPrompt}
              onChange={(event) => onAdvancedPromptChange(event.target.value)}
              rows={4}
              placeholder="e.g. keep wall thickness above 2mm and avoid unsupported overhangs"
            />
          </FormField>

          <Button
            size="sm"
            variant="outline"
            iconLeft={<Save className="h-3.5 w-3.5" />}
            loading={busyAction === "save-model-selection"}
            disabled={busyAction !== null || !activeContextId}
            onClick={onSaveModelSelection}
          >
            Save Model Selection
          </Button>
          {!activeContextId ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              You are in draft mode. Model selection will be stored after first message creates a context.
            </p>
          ) : null}
        </div>
      </TabPanel>

      <TabPanel hidden={rightPaneTab !== "files"}>
        {selectedAssistantFiles.length === 0 ? (
          <EmptyState title="No files available" description="Generated files will appear after assistant responses." />
        ) : (
          <ul className="space-y-2">
            {selectedAssistantFiles.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-2 rounded-md border border-[hsl(var(--border))] p-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  <span className="line-clamp-1 text-sm">{file.filename}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  iconLeft={<Download className="h-3.5 w-3.5" />}
                  disabled={busyAction !== null}
                  onClick={() => onDownloadFile(file.path)}
                >
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
      </TabPanel>

      <TabPanel hidden={rightPaneTab !== "history"}>
        {queryStates.length === 0 ? (
          <EmptyState title="No query history" description="Run a query to capture state transitions here." />
        ) : (
          <ul className="space-y-2">
            {queryStates.map((state) => (
              <li key={state.id} className="rounded-md border border-[hsl(var(--border))] p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{state.state}</span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {new Date(state.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {state.detail ? <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{state.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
    </div>
  );
}
