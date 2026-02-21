import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Box, MessageSquare, Sidebar, User } from "lucide-react";
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
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { adaptChatItem } from "../features/chat/chat-adapters";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { toErrorMessage, fileExtension, uniqueFilesByPath } from "./chat/utils";
import { ContextSidebar } from "./chat/ContextSidebar";
import { MessageBubble } from "./chat/MessageBubble";
import { PromptComposer } from "./chat/PromptComposer";
import { WorkbenchPane } from "./chat/WorkbenchPane";

type MobilePane = "contexts" | "thread" | "workbench";

type ContextBucket = "Today" | "Last 7 days" | "Older";

function asContextId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatState(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function routeForContext(contextId: string): string {
  return `/chat/${encodeURIComponent(contextId)}`;
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
  const { notifications } = useNotifications();
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

  async function createContextAction(overrideName?: string) {
    if (!token) {
      return;
    }

    const name = (overrideName ?? newContextName).trim() || "Untitled chat";
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

  async function uploadSelectedFilesAction(filesToUpload?: File[]) {
    const files = filesToUpload ?? selectedUploadFiles;
    if (!token || files.length === 0) {
      return;
    }

    setBusyAction("upload-attachments");
    setError("");
    setMessage("");
    try {
      const uploaded: QueryAttachment[] = [];
      for (const file of files) {
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

  return (
    <section className="space-y-3">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-[hsl(var(--foreground))]">
            {activeContext ? activeContext.name : "New conversation"}
          </h2>
          <div className="flex items-center gap-2">
            {lastQueryState ? <Badge tone="info">query: {lastQueryState.state}</Badge> : null}
          </div>
        </div>
      </header>

      {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <div className="sticky top-[64px] z-20 rounded-lg border bg-[hsl(var(--surface-1))] p-1 xl:hidden">
        <div className="grid grid-cols-3 gap-1">
          {mobilePaneTabs.map((tab) => {
            const icons: Record<MobilePane, typeof Sidebar> = { contexts: Sidebar, thread: MessageSquare, workbench: Box };
            const Icon = icons[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition ${
                  mobilePane === tab.id
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
                onClick={() => setMobilePane(tab.id)}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        <aside className={`${mobilePane === "contexts" ? "block" : "hidden"} xl:block`}>
          <ContextSidebar
            groupedContexts={groupedContexts}
            activeContextId={activeContextId}
            isDraftRoute={isDraftRoute}
            busyAction={busyAction}
            token={token}
            onNavigateNew={() => navigate("/chat")}
            onCreateNamed={(name) => void createContextAction(name)}
            onSelect={(contextId) => {
              navigate(routeForContext(contextId));
              setMobilePane("thread");
            }}
            onRename={(context) => void renameContextAction(context)}
            onDelete={(context) => void deleteContextAction(context)}
          />
        </aside>

        <section className={`${mobilePane === "thread" ? "block" : "hidden"} min-w-0 xl:block`}>
          <div className="space-y-3 rounded-xl border bg-[hsl(var(--surface-1))] p-3 shadow-[var(--elevation-1)]">
            <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border)_/_0.5)] pb-2">
              <h3 className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                {activeContext ? "Conversation" : "New draft — context created on first send"}
              </h3>
            </div>

            <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
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

              {visibleTimelineItems.map((item) => (
                <MessageBubble
                  key={item.id}
                  item={item}
                  isSelected={selectedAssistantItemId === item.id}
                  busyAction={busyAction}
                  onSelect={(itemId) => {
                    setSelectedAssistantItemId(itemId);
                    setMobilePane("workbench");
                  }}
                  onRate={(rateItem, rating) => void rateItemAction(rateItem, rating)}
                  onRegenerate={(assistantItemId) => void regenerateAction(assistantItemId)}
                  onDownloadFile={(filePath) => void downloadFileAction(filePath)}
                />
              ))}

              {optimisticPrompt ? (
                <>
                  <article className="animate-fade-in rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                        <User className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-semibold uppercase tracking-wide">user</span>
                    </div>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{optimisticPrompt}</ReactMarkdown>
                  </article>
                  <article className="animate-fade-in rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 text-sm">
                    <div className="mb-2 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]">
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-semibold uppercase tracking-wide">assistant</span>
                    </div>
                    <div className="space-y-2" data-testid="optimistic-pending">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </article>
                </>
              ) : null}

              <div ref={timelineEndRef} />
            </div>

            <PromptComposer
              prompt={prompt}
              onPromptChange={setPrompt}
              queuedAttachments={queuedAttachments}
              busyAction={busyAction}
              hasAssistantItems={activeAssistantItems.length > 0}
              activeContextId={activeContextId}
              onSubmit={() => void submitPromptAction()}
              onAttachFiles={(files) => void uploadSelectedFilesAction(files)}
              onRemoveAttachment={(path) => setQueuedAttachments((current) => current.filter((a) => a.path !== path))}
              onRegenerate={() => {
                const latest = activeAssistantItems[activeAssistantItems.length - 1];
                if (latest) {
                  void regenerateAction(latest.id);
                }
              }}
            />
          </div>
        </section>

        <aside className={`${mobilePane === "workbench" ? "block" : "hidden"} xl:block`}>
          <WorkbenchPane
            selectedAssistantItem={selectedAssistantItem}
            selectedAssistantFiles={selectedAssistantFiles}
            selectedPreviewFile={selectedPreviewFile}
            queryStates={queryStates}
            conversationModels={conversationModels}
            codegenModels={codegenModels}
            conversationModelId={conversationModelId}
            codegenModelId={codegenModelId}
            outputFormat={outputFormat}
            detailLevel={detailLevel}
            advancedPrompt={advancedPrompt}
            activeContextId={activeContextId}
            busyAction={busyAction}
            token={token}
            onConversationModelChange={setConversationModelId}
            onCodegenModelChange={setCodegenModelId}
            onOutputFormatChange={setOutputFormat}
            onDetailLevelChange={setDetailLevel}
            onAdvancedPromptChange={setAdvancedPrompt}
            onSaveModelSelection={() => void saveModelSelectionAction()}
            onDownloadFile={(filePath) => void downloadFileAction(filePath)}
          />
        </aside>
      </div>
    </section>
  );
}
