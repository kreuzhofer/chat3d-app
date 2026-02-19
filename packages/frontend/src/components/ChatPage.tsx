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
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { adaptChatItem } from "../features/chat/chat-adapters";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const LazyModelViewer = lazy(async () => {
  const module = await import("./ModelViewer");
  return { default: module.ModelViewer };
});

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

export function ChatPage() {
  const { token } = useAuth();
  const { notifications, connectionState, refreshReplay } = useNotifications();
  const navigate = useNavigate();
  const { contextId: contextIdParam } = useParams<{ contextId?: string }>();
  const location = useLocation();

  const isNewRoute = location.pathname === "/chat/new";
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
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const lastHandledNotificationIdRef = useRef(0);

  const activeContextId = !isNewRoute ? contextIdParam ?? null : null;

  const activeContext = useMemo(
    () => (activeContextId ? contexts.find((context) => context.id === activeContextId) ?? null : null),
    [activeContextId, contexts],
  );

  const conversationModels = useMemo(
    () => models.filter((model) => model.stage === "conversation"),
    [models],
  );
  const codegenModels = useMemo(
    () => models.filter((model) => model.stage === "codegen"),
    [models],
  );

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
      .slice(0, 10);
  }, [activeContextId, notifications]);

  const lastQueryState = queryStates[0] ?? null;

  const timelineItems = useMemo(() => items.map(adaptChatItem), [items]);
  const visibleTimelineItems = useMemo(
    () => timelineItems.slice(Math.max(timelineItems.length - visibleTimelineCount, 0)),
    [timelineItems, visibleTimelineCount],
  );

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
    if (isNewRoute) {
      return;
    }

    if (contexts.length === 0) {
      return;
    }

    if (!activeContextId) {
      navigate(routeForContext(contexts[0].id), { replace: true });
      return;
    }

    const activeExists = contexts.some((context) => context.id === activeContextId);
    if (!activeExists) {
      navigate(routeForContext(contexts[0].id), { replace: true });
    }
  }, [activeContextId, contexts, isNewRoute, navigate]);

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

      if (
        notification.eventType !== "chat.item.updated" &&
        notification.eventType !== "chat.query.state"
      ) {
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

  async function submitPromptAction() {
    if (!token || !activeContextId) {
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
      await submitQuery({
        token,
        contextId: activeContextId,
        prompt: trimmedPrompt,
        attachments: queuedAttachments.length > 0 ? queuedAttachments : undefined,
      });
      await refreshItems();
      setQueuedAttachments([]);
      setMessage("Prompt submitted.");
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

  return (
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Chats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="new-chat-name">New context</Label>
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
            <Button
              variant={isNewRoute ? "secondary" : "outline"}
              className="w-full"
              onClick={() => navigate("/chat/new")}
            >
              New Chat
            </Button>
          </div>

          <ul className="mt-4 space-y-2">
            {contexts.map((context) => (
              <li key={context.id} className="rounded-md border border-[hsl(var(--border))] p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-medium">{context.name}</span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {new Date(context.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant={activeContextId === context.id ? "secondary" : "outline"}
                    data-testid={`open-context-${context.id}`}
                    onClick={() => navigate(routeForContext(context.id))}
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
        </CardContent>
      </Card>

      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            {activeContext ? activeContext.name : "New Chat"}
            {lastQueryState ? (
              <span className="ml-2 rounded border px-2 py-1 text-xs font-normal">
                query: {lastQueryState.state}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {message ? <p className="rounded-md border p-2 text-sm">{message}</p> : null}
          {error ? (
            <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
              {error}
            </p>
          ) : null}

          {activeContext ? (
            <>
              <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="conversation-model">Conversation model</Label>
                  <select
                    id="conversation-model"
                    className="h-9 w-full rounded-md border border-[hsl(var(--border))] bg-white px-2 text-sm"
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
                </div>
                <div className="space-y-1">
                  <Label htmlFor="codegen-model">Codegen model</Label>
                  <select
                    id="codegen-model"
                    className="h-9 w-full rounded-md border border-[hsl(var(--border))] bg-white px-2 text-sm"
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
                </div>
                <div className="md:col-span-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void saveModelSelectionAction();
                    }}
                  >
                    Save Model Selection
                  </Button>
                </div>
              </div>

              <div className="mt-3 max-h-[56vh] space-y-3 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-3">
                {timelineItems.length > visibleTimelineItems.length ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVisibleTimelineCount((current) => current + 80)}
                  >
                    Show Older Messages ({timelineItems.length - visibleTimelineItems.length})
                  </Button>
                ) : null}

                {timelineItems.length === 0 && !optimisticPrompt ? (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    Start the conversation by sending a prompt.
                  </p>
                ) : null}

                {visibleTimelineItems.map((item) => {
                  const allFiles = uniqueFilesByPath(item.segments.flatMap((segment) => segment.files));
                  const preferredPreviewFile =
                    allFiles.find((file) => [".3mf", ".stl"].includes(fileExtension(file.path))) ??
                    allFiles.find((file) => [".step", ".stp"].includes(fileExtension(file.path))) ??
                    null;
                  const extensionLabels = [
                    { extension: ".step", label: "STEP" },
                    { extension: ".stp", label: "STP" },
                    { extension: ".stl", label: "STL" },
                    { extension: ".3mf", label: "3MF" },
                    { extension: ".b123d", label: "B123D" },
                  ];

                  return (
                    <div
                      key={item.id}
                      className={`rounded-md border p-3 ${
                        item.role === "user"
                          ? "border-[hsl(var(--border))] bg-[hsl(var(--muted))]"
                          : "border-[hsl(var(--border))] bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                        <span className="uppercase tracking-wide">{item.role}</span>
                        <span>{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="space-y-2">
                        {item.segments.map((segment) => {
                          const isAttachment = segment.kind === "attachment";

                          return (
                            <div
                              key={segment.id}
                              className={`rounded border p-2 ${
                                segment.kind === "error"
                                  ? "border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]"
                                  : "border-[hsl(var(--border))]"
                              }`}
                            >
                              {isAttachment ? (
                                <div className="space-y-2">
                                  <p className="text-sm font-medium">
                                    {segment.text ||
                                      `${segment.attachmentKind === "image" ? "Image" : "File"} attachment`}
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

                              {segment.kind === "model" && segment.attachmentPath ? (
                                <div className="mt-2">
                                  <Suspense
                                    fallback={
                                      <p className="text-sm text-[hsl(var(--muted-foreground))]">
                                        Loading 3D viewer module...
                                      </p>
                                    }
                                  >
                                    <LazyModelViewer token={token ?? ""} filePath={segment.attachmentPath} />
                                  </Suspense>
                                </div>
                              ) : null}

                              {segment.kind === "meta" && segment.usage ? (
                                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                                  Usage: {segment.usage.inputTokens} in / {segment.usage.outputTokens} out /{" "}
                                  {segment.usage.totalTokens} total · est. ${formatEstimatedCostUsd(segment.usage.estimatedCostUsd)}
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
                              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                                state: {segment.state}
                                {segment.stateMessage ? ` (${segment.stateMessage})` : ""}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {item.role === "assistant" && allFiles.length > 0 ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[hsl(var(--border))] p-2">
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
                                Download {entry.label}
                              </Button>
                            );
                          })}
                          {preferredPreviewFile && fileExtension(preferredPreviewFile.path) === ".step" ? (
                            <p className="text-xs text-[hsl(var(--muted-foreground))]">
                              Preview available after exporting STL or 3MF.
                            </p>
                          ) : null}
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
                            disabled={busyAction !== null}
                            onClick={() => {
                              void regenerateAction(item.id);
                            }}
                          >
                            Regenerate
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {optimisticPrompt ? (
                  <>
                    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
                      <div className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">user</div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{optimisticPrompt}</ReactMarkdown>
                    </div>
                    <div className="rounded-md border border-[hsl(var(--border))] bg-white p-3 text-sm">
                      <div className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        assistant
                      </div>
                      <p data-testid="optimistic-pending">Waiting for assistant response...</p>
                    </div>
                  </>
                ) : null}

                <div ref={timelineEndRef} />
              </div>

              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-[hsl(var(--border))] p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[240px] flex-1 space-y-1">
                      <Label htmlFor="chat-attachments">Attach files</Label>
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
                    <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                      Selected: {selectedUploadFiles.map((file) => file.name).join(", ")}
                    </p>
                  ) : null}

                  {queuedAttachments.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {queuedAttachments.map((attachment) => (
                        <li
                          key={attachment.path}
                          className="flex items-center justify-between gap-2 rounded border border-[hsl(var(--border))] p-2 text-sm"
                        >
                          <span className="line-clamp-1">
                            {attachment.kind === "image" ? "Image" : "File"}: {attachment.filename}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeQueuedAttachmentAction(attachment.path)}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[260px] flex-1 space-y-1">
                  <Label htmlFor="chat-prompt">Prompt</Label>
                  <Input
                    id="chat-prompt"
                    data-testid="chat-prompt-input"
                    placeholder="Ask Chat3D..."
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void submitPromptAction();
                      }
                    }}
                  />
                </div>
                <Button
                  disabled={busyAction !== null || prompt.trim() === ""}
                  onClick={() => {
                    void submitPromptAction();
                  }}
                >
                  Send
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void refreshReplay();
                  }}
                >
                  Refresh Events ({connectionState})
                </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-md border border-[hsl(var(--border))] p-4">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Create a new chat or open an existing context to start messaging.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate("/chat")}>Open Latest Chat</Button>
                <Button variant="outline" onClick={() => navigate("/chat/new")}>
                  Stay on New Chat
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
