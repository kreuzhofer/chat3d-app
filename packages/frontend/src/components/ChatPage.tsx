import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createChatContext,
  deleteChatContext,
  listChatContexts,
  listChatItems,
  type ChatContext,
  type ChatItem,
  updateChatContext,
  updateChatItem,
} from "../api/chat.api";
import { downloadFileBinary, uploadFileBase64 } from "../api/files.api";
import { listLlmModels, regenerateQuery, submitQuery, type LlmModel, type QueryAttachment } from "../api/query.api";
import { EmptyState } from "./layout/EmptyState";
import { InlineAlert } from "./layout/InlineAlert";
import { CommandBarTrigger } from "./layout/CommandBarTrigger";
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { adaptChatItem } from "../features/chat/chat-adapters";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FormField } from "./ui/form";
import { Input } from "./ui/input";
import { Tabs, TabPanel } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

const LazyModelViewer = lazy(async () => {
  const module = await import("./ModelViewer");
  return { default: module.ModelViewer };
});

type MobilePane = "contexts" | "thread" | "workbench";
type RightPaneTab = "preview" | "parameters" | "files" | "history";

type ContextBucket = "Today" | "Last 7 days" | "Older";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asContextId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatState(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function routeForContext(contextId: string): string {
  return `/chat/${encodeURIComponent(contextId)}`;
}

function fileExtension(path: string): string {
  const normalized = path.toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
}

function sanitizeUploadFilename(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "upload.bin";
}

function inferAttachmentKind(file: File): "image" | "file" {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  const extension = fileExtension(file.name);
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension) ? "image" : "file";
}

function formatEstimatedCostUsd(value: number): string {
  return value.toFixed(6);
}

function uniqueFilesByPath(
  files: Array<{
    path: string;
    filename: string;
  }>,
) {
  const unique = new Map<string, { path: string; filename: string }>();
  for (const file of files) {
    if (!file.path) {
      continue;
    }
    if (!unique.has(file.path)) {
      unique.set(file.path, file);
    }
  }
  return [...unique.values()];
}

function contextBucketLabel(updatedAt: string): ContextBucket {
  const now = Date.now();
  const ageMs = now - Date.parse(updatedAt);
  const oneDay = 24 * 60 * 60 * 1000;
  if (ageMs < oneDay) {
    return "Today";
  }
  if (ageMs < 7 * oneDay) {
    return "Last 7 days";
  }
  return "Older";
}

function groupContexts(contexts: ChatContext[]): Record<ContextBucket, ChatContext[]> {
  const grouped: Record<ContextBucket, ChatContext[]> = {
    Today: [],
    "Last 7 days": [],
    Older: [],
  };

  for (const context of contexts) {
    grouped[contextBucketLabel(context.updatedAt)].push(context);
  }

  for (const key of Object.keys(grouped) as ContextBucket[]) {
    grouped[key] = grouped[key].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  return grouped;
}

export function ChatPage() {
  const { token } = useAuth();
  const { notifications, connectionState, refreshReplay } = useNotifications();
  const navigate = useNavigate();
  const { contextId: contextIdParam } = useParams<{ contextId?: string }>();
  const location = useLocation();

  const isDraftRoute = location.pathname === "/chat" || location.pathname === "/chat/new";
  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [newContextName, setNewContextName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [optimisticPrompt, setOptimisticPrompt] = useState<string | null>(null);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [queuedAttachments, setQueuedAttachments] = useState<QueryAttachment[]>([]);
  const [visibleTimelineCount, setVisibleTimelineCount] = useState(80);
  const [conversationModelId, setConversationModelId] = useState("");
  const [codegenModelId, setCodegenModelId] = useState("");
  const [mobilePane, setMobilePane] = useState<MobilePane>("thread");
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("preview");
  const [selectedAssistantItemId, setSelectedAssistantItemId] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<"stl" | "3mf" | "step">("stl");
  const [detailLevel, setDetailLevel] = useState<"low" | "medium" | "high">("medium");
  const [advancedPrompt, setAdvancedPrompt] = useState("");

  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const lastHandledNotificationIdRef = useRef(0);

  const activeContextId = !isDraftRoute ? contextIdParam ?? null : null;

  const activeContext = useMemo(
    () => (activeContextId ? contexts.find((context) => context.id === activeContextId) ?? null : null),
    [activeContextId, contexts],
  );

  const conversationModels = useMemo(() => models.filter((model) => model.stage === "conversation"), [models]);
  const codegenModels = useMemo(() => models.filter((model) => model.stage === "codegen"), [models]);

  const queryStates = useMemo(() => {
    if (!activeContextId) {
      return [];
    }

    return notifications
      .filter((notification) => {
        if (notification.eventType !== "chat.query.state") {
          return false;
        }
        return asContextId(notification.payload.contextId) === activeContextId;
      })
      .map((notification) => ({
        id: notification.id,
        state: formatState(notification.payload.state),
        detail: typeof notification.payload.detail === "string" ? notification.payload.detail : "",
        createdAt: notification.createdAt,
      }))
      .slice(0, 15);
  }, [activeContextId, notifications]);

  const lastQueryState = queryStates[0] ?? null;

  const timelineItems = useMemo(() => items.map(adaptChatItem), [items]);
  const visibleTimelineItems = useMemo(
    () => timelineItems.slice(Math.max(timelineItems.length - visibleTimelineCount, 0)),
    [timelineItems, visibleTimelineCount],
  );

  const groupedContexts = useMemo(() => groupContexts(contexts), [contexts]);

  const activeAssistantItems = useMemo(
    () => timelineItems.filter((item) => item.role === "assistant"),
    [timelineItems],
  );

  const selectedAssistantItem = useMemo(() => {
    if (activeAssistantItems.length === 0) {
      return null;
    }
    if (selectedAssistantItemId) {
      const matched = activeAssistantItems.find((item) => item.id === selectedAssistantItemId);
      if (matched) {
        return matched;
      }
    }
    return activeAssistantItems[activeAssistantItems.length - 1] ?? null;
  }, [activeAssistantItems, selectedAssistantItemId]);

  const selectedAssistantFiles = useMemo(() => {
    if (!selectedAssistantItem) {
      return [];
    }
    return uniqueFilesByPath(selectedAssistantItem.segments.flatMap((segment) => segment.files));
  }, [selectedAssistantItem]);

  const selectedPreviewFile = useMemo(() => {
    return (
      selectedAssistantFiles.find((file) => [".3mf", ".stl"].includes(fileExtension(file.path))) ??
      selectedAssistantFiles.find((file) => [".step", ".stp"].includes(fileExtension(file.path))) ??
      null
    );
  }, [selectedAssistantFiles]);

  const refreshContexts = useCallback(async () => {
    if (!token) {
      setContexts([]);
      return;
    }

    const loaded = await listChatContexts(token);
    setContexts(loaded);
  }, [token]);

  const refreshItems = useCallback(async () => {
    if (!token || !activeContextId) {
      setItems([]);
      return;
    }

    const loaded = await listChatItems(token, activeContextId);
    setItems(loaded);
  }, [activeContextId, token]);

  const refreshModels = useCallback(async () => {
    if (!token) {
      setModels([]);
      return;
    }

    const loaded = await listLlmModels(token);
    setModels(loaded);
  }, [token]);

  useEffect(() => {
    void refreshContexts().catch((loadError) => setError(toErrorMessage(loadError)));
    void refreshModels().catch((loadError) => setError(toErrorMessage(loadError)));
  }, [refreshContexts, refreshModels]);

  useEffect(() => {
    void refreshItems().catch((loadError) => setError(toErrorMessage(loadError)));
  }, [refreshItems]);

  useEffect(() => {
    if (isDraftRoute || !contextIdParam || contexts.length === 0) {
      return;
    }

    const activeExists = contexts.some((context) => context.id === contextIdParam);
    if (!activeExists) {
      navigate("/chat", { replace: true });
      setError("Requested chat context was not found.");
    }
  }, [contextIdParam, contexts, isDraftRoute, navigate]);

  useEffect(() => {
    setConversationModelId(activeContext?.conversationModelId ?? "");
    setCodegenModelId(activeContext?.chat3dModelId ?? "");
    setVisibleTimelineCount(80);
    setSelectedUploadFiles([]);
    setQueuedAttachments([]);
  }, [activeContext?.chat3dModelId, activeContext?.conversationModelId, activeContextId]);

  useEffect(() => {
    if (!activeContextId || notifications.length === 0) {
      return;
    }

    const latestId = notifications[0].id;
    const hasRelevantUpdate = notifications.some((notification) => {
      if (notification.id <= lastHandledNotificationIdRef.current) {
        return false;
      }

      if (notification.eventType !== "chat.item.updated" && notification.eventType !== "chat.query.state") {
        return false;
      }

      return asContextId(notification.payload.contextId) === activeContextId;
    });

    lastHandledNotificationIdRef.current = Math.max(lastHandledNotificationIdRef.current, latestId);

    if (hasRelevantUpdate) {
      void refreshItems().catch((loadError) => setError(toErrorMessage(loadError)));
    }
  }, [activeContextId, notifications, refreshItems]);

  useEffect(() => {
    const target = timelineEndRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [lastQueryState?.id, optimisticPrompt, visibleTimelineItems.length]);

  useEffect(() => {
    if (activeAssistantItems.length === 0) {
      setSelectedAssistantItemId(null);
      return;
    }

    if (selectedAssistantItemId && activeAssistantItems.some((item) => item.id === selectedAssistantItemId)) {
      return;
    }

    setSelectedAssistantItemId(activeAssistantItems[activeAssistantItems.length - 1].id);
  }, [activeAssistantItems, selectedAssistantItemId]);

  async function createContextAction() {
    if (!token) {
      return;
    }

    const name = newContextName.trim() || "Untitled chat";
    setBusyAction("create-context");
    setError("");
    setMessage("");

    try {
      const created = await createChatContext(token, name);
      setNewContextName("");
      await refreshContexts();
      navigate(routeForContext(created.id));
      setMessage("Chat context created.");
      setMobilePane("thread");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function renameContextAction(context: ChatContext) {
    if (!token) {
      return;
    }

    const nextName = window.prompt("Rename chat context", context.name);
    if (nextName === null) {
      return;
    }

    const trimmed = nextName.trim();
    if (trimmed === "") {
      setError("Context name cannot be empty.");
      return;
    }

    setBusyAction(`rename-${context.id}`);
    setError("");
    setMessage("");

    try {
      await updateChatContext(token, context.id, {
        name: trimmed,
      });
      await refreshContexts();
      setMessage("Context renamed.");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteContextAction(context: ChatContext) {
    if (!token) {
      return;
    }

    const confirmed = window.confirm(`Delete context "${context.name}"?`);
    if (!confirmed) {
      return;
    }

    setBusyAction(`delete-${context.id}`);
    setError("");
    setMessage("");

    try {
      await deleteChatContext(token, context.id);
      await refreshContexts();
      if (activeContextId === context.id) {
        navigate("/chat");
      }
      setMessage("Context deleted.");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function saveModelSelectionAction() {
    if (!token || !activeContextId) {
      return;
    }

    setBusyAction("save-model-selection");
    setError("");
    setMessage("");

    try {
      await updateChatContext(token, activeContextId, {
        conversationModelId: conversationModelId || null,
        chat3dModelId: codegenModelId || null,
      });
      await refreshContexts();
      setMessage("Model selection saved for this context.");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function ensureContextForPrompt(): Promise<string | null> {
    if (!token) {
      return null;
    }

    if (activeContextId) {
      return activeContextId;
    }

    const fallbackName = newContextName.trim() || `New chat ${new Date().toLocaleString()}`;
    const created = await createChatContext(token, fallbackName);

    if (conversationModelId || codegenModelId) {
      await updateChatContext(token, created.id, {
        conversationModelId: conversationModelId || null,
        chat3dModelId: codegenModelId || null,
      });
    }

    await refreshContexts();
    navigate(routeForContext(created.id));
    return created.id;
  }

  function buildEffectivePrompt(basePrompt: string): string {
    const hasCustomPreferences =
      outputFormat !== "stl" || detailLevel !== "medium" || advancedPrompt.trim() !== "";
    if (!hasCustomPreferences) {
      return basePrompt;
    }

    const lines: string[] = [];
    lines.push(`Preferred output format: ${outputFormat.toUpperCase()}`);
    lines.push(`Detail level: ${detailLevel}`);
    if (advancedPrompt.trim()) {
      lines.push(`Additional constraints: ${advancedPrompt.trim()}`);
    }

    return `${basePrompt}\n\n[Generation Preferences]\n${lines.join("\n")}`;
  }

  async function submitPromptAction() {
    if (!token) {
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      return;
    }

    setBusyAction("submit-prompt");
    setError("");
    setMessage("");
    setOptimisticPrompt(trimmedPrompt);
    setPrompt("");

    try {
      const targetContextId = await ensureContextForPrompt();
      if (!targetContextId) {
        throw new Error("Unable to create or resolve context.");
      }

      await submitQuery({
        token,
        contextId: targetContextId,
        prompt: buildEffectivePrompt(trimmedPrompt),
        attachments: queuedAttachments.length > 0 ? queuedAttachments : undefined,
      });

      const loaded = await listChatItems(token, targetContextId);
      setItems(loaded);
      setQueuedAttachments([]);
      setMessage("Prompt submitted.");
      setMobilePane("thread");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
      setOptimisticPrompt(null);
    }
  }

  async function downloadFileAction(filePath: string) {
    if (!token) {
      return;
    }

    setBusyAction(`download-${filePath}`);
    setError("");
    try {
      const downloaded = await downloadFileBinary({
        token,
        path: filePath,
      });
      const url = URL.createObjectURL(downloaded.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloaded.filename;
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadSelectedFilesAction() {
    if (!token || selectedUploadFiles.length === 0) {
      return;
    }

    setBusyAction("upload-attachments");
    setError("");
    setMessage("");
    try {
      const uploaded: QueryAttachment[] = [];
      for (const file of selectedUploadFiles) {
        const fileBuffer = await file.arrayBuffer();
        const extension = fileExtension(file.name) || ".bin";
        const uniqueName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${sanitizeUploadFilename(file.name)}`;
        const path = `uploads/${uniqueName}${uniqueName.endsWith(extension) ? "" : extension}`;
        const saved = await uploadFileBase64({
          token,
          path,
          contentBase64: toBase64(fileBuffer),
          contentType: file.type || undefined,
        });

        uploaded.push({
          path: saved.path,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          kind: inferAttachmentKind(file),
        });
      }

      setQueuedAttachments((current) => {
        const next = [...current];
        for (const entry of uploaded) {
          if (!next.some((existing) => existing.path === entry.path)) {
            next.push(entry);
          }
        }
        return next;
      });
      setSelectedUploadFiles([]);
      setMessage(`Uploaded ${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"}.`);
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  function removeQueuedAttachmentAction(path: string) {
    setQueuedAttachments((current) => current.filter((attachment) => attachment.path !== path));
  }

  async function rateItemAction(item: { id: string; rating: -1 | 0 | 1 }, rating: -1 | 1) {
    if (!token || !activeContextId) {
      return;
    }

    const nextRating = item.rating === rating ? 0 : rating;
    setBusyAction(`rate-${item.id}`);
    setError("");

    try {
      await updateChatItem({
        token,
        contextId: activeContextId,
        itemId: item.id,
        rating: nextRating,
      });
      await refreshItems();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function regenerateAction(assistantItemId: string) {
    if (!token || !activeContextId) {
      return;
    }

    setBusyAction(`regenerate-${assistantItemId}`);
    setError("");
    setMessage("");
    try {
      await regenerateQuery({
        token,
        contextId: activeContextId,
        assistantItemId,
      });
      await refreshItems();
      setMessage("Regeneration submitted.");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  const mobilePaneTabs = [
    { id: "contexts", label: "Contexts" },
    { id: "thread", label: "Thread" },
    { id: "workbench", label: "Model" },
  ] as const;

  const rightPaneTabs = [
    { id: "preview", label: "Preview" },
    { id: "parameters", label: "Parameters" },
    { id: "files", label: "Files" },
    { id: "history", label: "History" },
  ] as const;

  return (
    <section className="space-y-3">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-[hsl(var(--foreground))]">
            {activeContext ? activeContext.name : "New conversation draft"}
          </h2>
          <div className="flex items-center gap-2">
            {lastQueryState ? <Badge tone="info">query: {lastQueryState.state}</Badge> : null}
            <Badge tone={connectionState === "open" ? "success" : "warning"}>SSE {connectionState}</Badge>
            <CommandBarTrigger className="hidden lg:flex" onClick={() => setMessage("Command palette entry point is ready.")} />
          </div>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Desktop uses 3 panes. Mobile uses segmented pane switching to maximize working space.
        </p>
      </header>

      {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <div className="sticky top-[64px] z-20 rounded-lg border bg-white p-1 xl:hidden">
        <div className="grid grid-cols-3 gap-1">
          {mobilePaneTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                mobilePane === tab.id
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
              }`}
              onClick={() => setMobilePane(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        <aside className={`${mobilePane === "contexts" ? "block" : "hidden"} xl:block`}>
          <div className="space-y-3 rounded-xl border bg-white p-3 shadow-[var(--elevation-1)]">
            <FormField label="Create Context" htmlFor="new-chat-name" helperText="Optional. A draft is created automatically on first send.">
              <div className="flex gap-2">
                <Input
                  id="new-chat-name"
                  value={newContextName}
                  onChange={(event) => setNewContextName(event.target.value)}
                  placeholder="Context name"
                />
                <Button
                  disabled={!token || busyAction !== null}
                  onClick={() => {
                    void createContextAction();
                  }}
                >
                  Create
                </Button>
              </div>
            </FormField>

            <Button variant={isDraftRoute ? "secondary" : "outline"} className="w-full" onClick={() => navigate("/chat")}>
              New Chat Draft
            </Button>

            <div className="space-y-3">
              {(Object.keys(groupedContexts) as ContextBucket[]).map((bucket) => {
                const bucketItems = groupedContexts[bucket];
                if (bucketItems.length === 0) {
                  return null;
                }

                return (
                  <section key={bucket} className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                      {bucket}
                    </h3>
                    <ul className="space-y-2">
                      {bucketItems.map((context) => (
                        <li key={context.id} className="rounded-md border border-[hsl(var(--border))] p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="line-clamp-1 text-sm font-medium">{context.name}</span>
                            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                              {new Date(context.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant={activeContextId === context.id ? "secondary" : "outline"}
                              data-testid={`open-context-${context.id}`}
                              onClick={() => {
                                navigate(routeForContext(context.id));
                                setMobilePane("thread");
                              }}
                            >
                              Open
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyAction !== null}
                              onClick={() => {
                                void renameContextAction(context);
                              }}
                            >
                              Rename
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyAction !== null}
                              onClick={() => {
                                void deleteContextAction(context);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}

              {contexts.length === 0 ? (
                <EmptyState title="No contexts yet" description="Start a draft message or create a named context." />
              ) : null}
            </div>
          </div>
        </aside>

        <section className={`${mobilePane === "thread" ? "block" : "hidden"} min-w-0 xl:block`}>
          <div className="space-y-3 rounded-xl border bg-white p-3 shadow-[var(--elevation-1)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div>
                <h3 className="text-base font-semibold">Thread</h3>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {activeContext ? "Conversation context active" : "Draft mode: context will be created on first send."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void refreshReplay()}>
                  Refresh Events
                </Button>
                <Badge tone={activeContext ? "success" : "warning"}>{activeContext ? "Persisted" : "Draft"}</Badge>
              </div>
            </div>

            <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
              {timelineItems.length > visibleTimelineItems.length ? (
                <Button size="sm" variant="outline" onClick={() => setVisibleTimelineCount((current) => current + 80)}>
                  Show Older Messages ({timelineItems.length - visibleTimelineItems.length})
                </Button>
              ) : null}

              {timelineItems.length === 0 && !optimisticPrompt ? (
                <EmptyState
                  title="Start modeling"
                  description="Write your first prompt. A chat context is created automatically on first send."
                />
              ) : null}

              {visibleTimelineItems.map((item) => {
                const allFiles = uniqueFilesByPath(item.segments.flatMap((segment) => segment.files));
                const extensionLabels = [
                  { extension: ".step", label: "STEP" },
                  { extension: ".stp", label: "STP" },
                  { extension: ".stl", label: "STL" },
                  { extension: ".3mf", label: "3MF" },
                  { extension: ".b123d", label: "B123D" },
                ];

                return (
                  <article
                    key={item.id}
                    className={`rounded-lg border p-3 transition ${
                      item.role === "user"
                        ? "border-[hsl(var(--border))] bg-[hsl(var(--muted))]"
                        : "border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]"
                    }`}
                    onClick={() => {
                      if (item.role === "assistant") {
                        setSelectedAssistantItemId(item.id);
                        setRightPaneTab("preview");
                        setMobilePane("workbench");
                      }
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="font-semibold uppercase tracking-wide">{item.role}</span>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>

                    <div className="space-y-2">
                      {item.segments.map((segment) => {
                        const isAttachment = segment.kind === "attachment";

                        return (
                          <div
                            key={segment.id}
                            className={`rounded-md border p-2 ${
                              segment.kind === "error"
                                ? "border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]"
                                : "border-[hsl(var(--border))]"
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
                                      void downloadFileAction(segment.attachmentPath);
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
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md border border-[hsl(var(--border))] p-2">
                        {extensionLabels.map((entry) => {
                          const matched = allFiles.find((file) => fileExtension(file.path) === entry.extension);
                          return (
                            <Button
                              key={`${item.id}-${entry.extension}`}
                              size="sm"
                              variant="outline"
                              disabled={!matched || busyAction !== null}
                              onClick={() => {
                                if (matched) {
                                  void downloadFileAction(matched.path);
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
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={item.rating === 1 ? "secondary" : "outline"}
                          disabled={busyAction !== null}
                          onClick={() => {
                            void rateItemAction(item, 1);
                          }}
                        >
                          Thumbs up
                        </Button>
                        <Button
                          size="sm"
                          variant={item.rating === -1 ? "secondary" : "outline"}
                          disabled={busyAction !== null}
                          onClick={() => {
                            void rateItemAction(item, -1);
                          }}
                        >
                          Thumbs down
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyAction !== null || !activeContextId}
                          onClick={() => {
                            void regenerateAction(item.id);
                          }}
                        >
                          Regenerate
                        </Button>
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {optimisticPrompt ? (
                <>
                  <article className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">user</div>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{optimisticPrompt}</ReactMarkdown>
                  </article>
                  <article className="animate-pulse rounded-md border border-[hsl(var(--border))] bg-white p-3 text-sm">
                    <div className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">assistant</div>
                    <p data-testid="optimistic-pending">Waiting for assistant response...</p>
                  </article>
                </>
              ) : null}

              <div ref={timelineEndRef} />
            </div>

            <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <FormField label="Attach files" htmlFor="chat-attachments" helperText="Images and reference files are supported.">
                    <Input
                      id="chat-attachments"
                      data-testid="chat-attachments-input"
                      type="file"
                      multiple
                      onChange={(event) => {
                        const nextFiles = event.target.files ? [...event.target.files] : [];
                        setSelectedUploadFiles(nextFiles);
                      }}
                    />
                  </FormField>
                </div>
                <Button
                  variant="outline"
                  disabled={busyAction !== null || selectedUploadFiles.length === 0}
                  onClick={() => {
                    void uploadSelectedFilesAction();
                  }}
                >
                  Upload Selected
                </Button>
              </div>

              {selectedUploadFiles.length > 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Selected: {selectedUploadFiles.map((file) => file.name).join(", ")}
                </p>
              ) : null}

              {queuedAttachments.length > 0 ? (
                <ul className="space-y-2">
                  {queuedAttachments.map((attachment) => (
                    <li
                      key={attachment.path}
                      className="flex items-center justify-between gap-2 rounded border border-[hsl(var(--border))] bg-white p-2 text-sm"
                    >
                      <span className="line-clamp-1">
                        {attachment.kind === "image" ? "Image" : "File"}: {attachment.filename}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => removeQueuedAttachmentAction(attachment.path)}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <FormField
                label="Prompt"
                htmlFor="chat-prompt"
                helperText="Shortcut: Cmd/Ctrl + Enter to send. Shift + Enter for newline."
              >
                <Textarea
                  id="chat-prompt"
                  data-testid="chat-prompt-input"
                  placeholder="Describe the part, dimensions, and constraints..."
                  value={prompt}
                  rows={4}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void submitPromptAction();
                    }
                  }}
                />
              </FormField>

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busyAction !== null || prompt.trim() === ""} onClick={() => void submitPromptAction()}>
                  Send
                </Button>
                <Button
                  variant="outline"
                  disabled={busyAction !== null || !activeContextId || activeAssistantItems.length === 0}
                  onClick={() => {
                    const latest = activeAssistantItems[activeAssistantItems.length - 1];
                    if (latest) {
                      void regenerateAction(latest.id);
                    }
                  }}
                >
                  Regenerate Latest
                </Button>
                <Button
                  variant="outline"
                  disabled={busyAction !== null || !activeContextId || !selectedAssistantItem}
                  onClick={() => {
                    if (selectedAssistantItem) {
                      void regenerateAction(selectedAssistantItem.id);
                    }
                  }}
                >
                  Regenerate Selected
                </Button>
              </div>
            </div>
          </div>
        </section>

        <aside className={`${mobilePane === "workbench" ? "block" : "hidden"} xl:block`}>
          <div className="space-y-3 rounded-xl border bg-white p-3 shadow-[var(--elevation-1)]">
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
                  <select
                    id="conversation-model"
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-white px-2 text-sm"
                    value={conversationModelId}
                    onChange={(event) => setConversationModelId(event.target.value)}
                  >
                    <option value="">Default</option>
                    {conversationModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.provider} / {model.modelName}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Codegen model" htmlFor="codegen-model" helperText="Used for Build123d code synthesis.">
                  <select
                    id="codegen-model"
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-white px-2 text-sm"
                    value={codegenModelId}
                    onChange={(event) => setCodegenModelId(event.target.value)}
                  >
                    <option value="">Default</option>
                    {codegenModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.provider} / {model.modelName}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Preferred output format" htmlFor="output-format">
                  <select
                    id="output-format"
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-white px-2 text-sm"
                    value={outputFormat}
                    onChange={(event) => setOutputFormat(event.target.value as "stl" | "3mf" | "step")}
                  >
                    <option value="stl">STL (preview-friendly)</option>
                    <option value="3mf">3MF (preview-friendly)</option>
                    <option value="step">STEP (CAD exchange)</option>
                  </select>
                </FormField>

                <FormField label="Detail level" htmlFor="detail-level">
                  <select
                    id="detail-level"
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-white px-2 text-sm"
                    value={detailLevel}
                    onChange={(event) => setDetailLevel(event.target.value as "low" | "medium" | "high")}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </FormField>

                <FormField
                  label="Advanced prompt modifiers"
                  htmlFor="advanced-modifier"
                  helperText="Appended to each submission as additional constraints."
                >
                  <Textarea
                    id="advanced-modifier"
                    value={advancedPrompt}
                    onChange={(event) => setAdvancedPrompt(event.target.value)}
                    rows={4}
                    placeholder="e.g. keep wall thickness above 2mm and avoid unsupported overhangs"
                  />
                </FormField>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyAction !== null || !activeContextId}
                  onClick={() => {
                    void saveModelSelectionAction();
                  }}
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
                      <span className="line-clamp-1 text-sm">{file.filename}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyAction !== null}
                        onClick={() => {
                          void downloadFileAction(file.path);
                        }}
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
        </aside>
      </div>
    </section>
  );
}
