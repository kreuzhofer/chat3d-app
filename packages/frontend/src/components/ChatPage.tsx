import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { Bot, Box, MessageSquare, User } from "lucide-react";
import {
  createChatContext,
  listChatItems,
  revertToItem,
  type ChatItem,
  updateChatContext,
  updateChatItem,
} from "../api/chat.api";
import { downloadFileBinary, uploadFileBase64 } from "../api/files.api";
import {
  listLlmModels,
  regenerateQuery,
  stopQuery,
  submitQuery,
  extractParameters as extractParametersApi,
  reRenderWithParameters,
  type LlmModel,
  type QueryAttachment,
  type PendingFile,
  type ExtractedParameter,
} from "../api/query.api";
import { EmptyState } from "./layout/EmptyState";
import { InlineAlert } from "./layout/InlineAlert";
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { adaptChatItem } from "../features/chat/chat-adapters";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { toErrorMessage, fileExtension, uniqueFilesByPath } from "./chat/utils";
import { MessageBubble } from "./chat/MessageBubble";
import { useChatContexts } from "../hooks/useChatContexts";
import { PromptComposer } from "./chat/PromptComposer";
import { WorkbenchPane } from "./chat/WorkbenchPane";
import { useStreamingQuery } from "../hooks/useStreamingQuery";
import { TypingIndicator } from "./chat/TypingIndicator";
import { ExamplePrompts } from "./chat/ExamplePrompts";
import { CapabilityHints } from "./chat/CapabilityHints";
import { PushToggle } from "./chat/PushToggle";
import { getNotificationPermission, isPushSubscribed, subscribeToPush } from "../services/push";

type MobilePane = "thread" | "workbench";

function asContextId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatState(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function routeForContext(contextId: string): string {
  return `/chat/${encodeURIComponent(contextId)}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Result is "data:<mime>;base64,<data>" — strip the prefix
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

function inferAttachmentKind(file: File): "image" | "file" {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  const extension = fileExtension(file.name);
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension) ? "image" : "file";
}

export function ChatPage() {
  const { t } = useTranslation(["pages", "common"]);
  const { token, user } = useAuth();
  const { notifications } = useNotifications();
  const navigate = useNavigate();
  const { contextId: contextIdParam } = useParams<{ contextId?: string }>();
  const location = useLocation();

  const isDraftRoute = location.pathname === "/chat" || location.pathname === "/chat/new";
  const isAdmin = user?.role === "admin";
  const { contexts, activeContextId, refreshContexts } = useChatContexts();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [optimisticPrompt, setOptimisticPrompt] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [visibleTimelineCount, setVisibleTimelineCount] = useState(80);
  const [conversationModelId, setConversationModelId] = useState("");
  const [codegenModelId, setCodegenModelId] = useState("");
  const [mobilePane, setMobilePane] = useState<MobilePane>("thread");
  const [selectedAssistantItemId, setSelectedAssistantItemId] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<"stl" | "3mf" | "step">("stl");
  const [detailLevel, setDetailLevel] = useState<"low" | "medium" | "high">("medium");
  const [advancedPrompt, setAdvancedPrompt] = useState("");
  const [streamingAssistantItemId, setStreamingAssistantItemId] = useState<string | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(true); // assume subscribed to avoid flash
  const [pushBusy, setPushBusy] = useState(false);
  const [parameters, setParameters] = useState<ExtractedParameter[]>([]);
  const [tweakedValues, setTweakedValues] = useState<Record<string, number>>({});
  const [parametersLoading, setParametersLoading] = useState(false);
  const [reRenderBusy, setReRenderBusy] = useState(false);

  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const [scrollSettled, setScrollSettled] = useState(false);
  /** Tracks which assistantItemId was "activated" (isStreaming became true for it).
   *  The clearing effect only clears streamingAssistantItemId when its value matches
   *  this ref — preventing premature clears when a new ID is set but useStreamingQuery
   *  hasn't confirmed streaming yet (isStreaming is stale for one render). */
  const streamingActivatedForIdRef = useRef<string | null>(null);
  const streamingAssistantItemIdRef = useRef<string | null>(null);
  streamingAssistantItemIdRef.current = streamingAssistantItemId;
  const lastHandledNotificationIdRef = useRef(0);
  const prevAssistantItemCountRef = useRef<number | null>(null);
  /** When true, the auto-selection effect will pick the latest assistant item on next refresh. */
  const selectLatestOnRefreshRef = useRef(false);

  const activeContext = useMemo(
    () => (activeContextId ? contexts.find((context) => context.id === activeContextId) ?? null : null),
    [activeContextId, contexts],
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
      .slice(0, 15);
  }, [activeContextId, notifications]);

  const lastQueryState = queryStates[0] ?? null;

  const timelineItems = useMemo(() => items.map(adaptChatItem), [items]);
  const visibleTimelineItems = useMemo(
    () => timelineItems.slice(Math.max(timelineItems.length - visibleTimelineCount, 0)),
    [timelineItems, visibleTimelineCount],
  );

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

  // ── Streaming integration ──────────────────────────────────────────────────
  // streamingAssistantItemId is set when a prompt is submitted and the backend
  // returns the new assistant item. It's cleared when streaming completes.
  const streamingItemStartedAt = useMemo(() => {
    if (!streamingAssistantItemId) return null;
    const item = items.find((i) => i.id === streamingAssistantItemId);
    return item?.createdAt ?? null;
  }, [streamingAssistantItemId, items]);

  const {
    streamingText,
    queryState,
    queryStateDetail,
    isStreaming,
    isLongRunning,
    error: streamingError,
  } = useStreamingQuery({
    token,
    assistantItemId: streamingAssistantItemId,
    startedAt: streamingItemStartedAt,
  });

  // Clear streamingAssistantItemId when streaming finishes.
  //
  // Race-condition guard: when streamingAssistantItemId is first set,
  // isStreaming is still false for one render (useStreamingQuery's effect
  // hasn't committed yet). The old boolean `wasStreamingRef` approach
  // broke when IDs changed rapidly (regenerate after cancel) because
  // the boolean from a previous session could cause premature clears.
  //
  // Fix: track WHICH item ID streaming was activated for. The clearing
  // condition only fires when isStreaming goes false for the SAME ID
  // that was previously activated, preventing cross-session interference.
  useEffect(() => {
    if (isStreaming && streamingAssistantItemId) {
      streamingActivatedForIdRef.current = streamingAssistantItemId;
    }
    if (
      streamingAssistantItemId &&
      !isStreaming &&
      streamingActivatedForIdRef.current === streamingAssistantItemId
    ) {
      setStreamingAssistantItemId(null);
      streamingActivatedForIdRef.current = null;
    }
  }, [streamingAssistantItemId, isStreaming]);

  // Synchronize streamingAssistantItemId with the actual DB state of items.
  // Two jobs:
  // 1. (Reload recovery) If no streaming ID is set, scan for a pending item and restore it.
  // 2. (Completion fallback) If a streaming ID IS set but the item is no longer pending
  //    in the DB, clear it. This catches cases where the SSE "completed" event was lost
  //    (connection drop, timing) — the item refresh (triggered by chat.item.updated)
  //    is authoritative.
  useEffect(() => {
    if (!streamingAssistantItemId) {
      // No active streaming — look for a pending item (reload recovery).
      // Skip items whose updatedAt is older than 15 minutes — the backend
      // auto-resumes recent pending items on startup; anything older is
      // certainly dead. Uses updatedAt (not createdAt) so that resumed
      // pipelines (old createdAt but recently updated) are still picked up.
      const STALE_THRESHOLD_MS = 15 * 60 * 1000;
      const pendingItem = timelineItems.find(
        (item) => item.role === "assistant" &&
          item.segments.some((seg) => seg.kind === "message" && seg.state === "pending") &&
          (Date.now() - Date.parse(item.updatedAt)) < STALE_THRESHOLD_MS,
      );
      if (pendingItem) setStreamingAssistantItemId(pendingItem.id);
    } else {
      // Streaming active — verify the item is still pending
      const item = timelineItems.find((i) => i.id === streamingAssistantItemId);
      if (item) {
        const stillPending = item.segments.some(
          (seg) => seg.kind === "message" && seg.state === "pending",
        );
        if (!stillPending) {
          // Item completed in DB — clear streaming regardless of SSE event
          setStreamingAssistantItemId(null);
          streamingActivatedForIdRef.current = null;
        }
      } else if (timelineItems.length > 0) {
        // Item not found in timeline — likely switched context. Clear to avoid
        // stale streaming state blocking navigation.
        setStreamingAssistantItemId(null);
        streamingActivatedForIdRef.current = null;
      }
    }
  }, [timelineItems, streamingAssistantItemId]);

  // Show typing indicator only before conversation tokens arrive (queued / early conversation
  // when the assistant item hasn't been created yet or has no content).
  // Post-conversation stages (codegen, rendering, etc.) are shown inline in the MessageBubble
  // via queryStateDetail to avoid duplicate progress displays.
  const showTypingIndicator = isStreaming
    && !streamingError
    && streamingText.length === 0
    && !streamingAssistantItemId;

  // Check push subscription on mount
  useEffect(() => {
    void isPushSubscribed().then(setPushSubscribed);
  }, []);

  const notificationPermission = getNotificationPermission();
  const showEnableNotifications = !pushSubscribed
    && notificationPermission !== "denied"
    && notificationPermission !== "unsupported";

  const handleEnableNotifications = useCallback(async () => {
    if (!token || pushBusy) return;
    setPushBusy(true);
    try {
      const success = await subscribeToPush(token);
      if (success) setPushSubscribed(true);
    } finally {
      setPushBusy(false);
    }
  }, [token, pushBusy]);

  const refreshItems = useCallback(async () => {
    if (!token || !activeContextId) {
      setItems([]);
      return;
    }

    const loaded = await listChatItems(token, activeContextId);
    setItems(loaded);
    setError("");
  }, [activeContextId, token]);

  const refreshModels = useCallback(async () => {
    if (!token) {
      setModels([]);
      return;
    }

    const loaded = await listLlmModels(token);
    setModels(loaded);
    setError("");
  }, [token]);

  useEffect(() => {
    void refreshModels().catch((loadError) => setError(toErrorMessage(loadError)));
  }, [refreshModels]);

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
      setError(t("pages:chat.contextNotFound"));
    }
  }, [contextIdParam, contexts, isDraftRoute, navigate]);

  useEffect(() => {
    setConversationModelId(activeContext?.conversationModelId ?? "");
    setCodegenModelId(activeContext?.chat3dModelId ?? "");
    setVisibleTimelineCount(80);
    setPendingFiles((prev) => { prev.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); return []; });
    setStreamingAssistantItemId(null);
    setParameters([]);
    setTweakedValues({});
    setError("");
    setMessage("");
  }, [activeContext?.chat3dModelId, activeContext?.conversationModelId, activeContextId]);

  // Refresh sidebar when a context is renamed (independent of activeContextId)
  const lastHandledRenameIdRef = useRef(0);
  useEffect(() => {
    if (notifications.length === 0) {
      return;
    }

    const hasRename = notifications.some(
      (n) => n.id > lastHandledRenameIdRef.current && n.eventType === "chat.context.renamed",
    );

    lastHandledRenameIdRef.current = Math.max(lastHandledRenameIdRef.current, notifications[0].id);

    if (hasRename) {
      void refreshContexts().catch((loadError) => setError(toErrorMessage(loadError)));
    }
  }, [notifications, refreshContexts]);

  useEffect(() => {
    if (!activeContextId || notifications.length === 0) {
      return;
    }

    const latestId = notifications[0].id;
    let hasRelevantUpdate = false;

    const ACTIVE_PIPELINE_STATES = new Set(["queued", "conversation", "codegen", "rendering", "evaluating", "fixing", "retrying"]);

    for (const notification of notifications) {
      if (notification.id <= lastHandledNotificationIdRef.current) {
        break;
      }

      if (notification.eventType !== "chat.item.updated" && notification.eventType !== "chat.query.state") {
        continue;
      }

      if (asContextId(notification.payload.contextId) !== activeContextId) {
        continue;
      }

      hasRelevantUpdate = true;

      // Auto-activate streaming when an active pipeline state event arrives
      // for an item not currently tracked. This handles resumed pipelines
      // (old createdAt) and any case where the frontend missed the initial setup.
      if (
        notification.eventType === "chat.query.state" &&
        !streamingAssistantItemIdRef.current
      ) {
        const state = typeof notification.payload.state === "string" ? notification.payload.state : "";
        const itemId = typeof notification.payload.assistantItemId === "string" ? notification.payload.assistantItemId : "";
        if (ACTIVE_PIPELINE_STATES.has(state) && itemId) {
          setStreamingAssistantItemId(itemId);
        }
      }
    }

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
  }, [lastQueryState?.id, optimisticPrompt, visibleTimelineItems.length, streamingText]);

  // Mark scroll as settled after initial items load so lazy 3D viewers
  // don't all fire during the scroll-to-bottom animation.
  useEffect(() => {
    if (scrollSettled || visibleTimelineItems.length === 0) return;
    const timer = setTimeout(() => setScrollSettled(true), 600);
    return () => clearTimeout(timer);
  }, [scrollSettled, visibleTimelineItems.length]);

  // Reset settled state when switching conversations
  useEffect(() => {
    setScrollSettled(false);
  }, [activeContextId]);

  useEffect(() => {
    if (activeAssistantItems.length === 0) {
      setSelectedAssistantItemId(null);
      return;
    }

    // When the ref flag is set (e.g. after re-render), force-select the latest assistant item
    if (selectLatestOnRefreshRef.current) {
      selectLatestOnRefreshRef.current = false;
      setSelectedAssistantItemId(activeAssistantItems[activeAssistantItems.length - 1].id);
      return;
    }

    if (selectedAssistantItemId && activeAssistantItems.some((item) => item.id === selectedAssistantItemId)) {
      return;
    }

    setSelectedAssistantItemId(activeAssistantItems[activeAssistantItems.length - 1].id);
  }, [activeAssistantItems, selectedAssistantItemId]);

  // ── Mobile auto-switch to workbench on new generation ──────────────────────
  useEffect(() => {
    const count = activeAssistantItems.length;

    // Initialize ref on first render — don't auto-switch for existing history
    if (prevAssistantItemCountRef.current === null) {
      prevAssistantItemCountRef.current = count;
      return;
    }

    // Only act when a new assistant item appears
    if (count <= prevAssistantItemCountRef.current) {
      prevAssistantItemCountRef.current = count;
      return;
    }

    prevAssistantItemCountRef.current = count;

    // Check if the latest item has preview-ready files (STL/3MF)
    const latest = activeAssistantItems[count - 1];
    const hasPreviewFile = latest.segments.some((segment) =>
      segment.files.some((file) => {
        const ext = fileExtension(file.path);
        return ext === ".stl" || ext === ".3mf";
      }),
    );

    if (!hasPreviewFile) {
      return;
    }

    // Auto-switch only on mobile (below xl breakpoint = 1280px)
    if (window.innerWidth < 1280) {
      setMobilePane("workbench");
    }
  }, [activeAssistantItems]);

  // ── Extract parameters when selected assistant item changes ────────
  useEffect(() => {
    if (!token || !activeContextId || !selectedAssistantItem) {
      setParameters([]);
      setTweakedValues({});
      return;
    }

    // Only extract if the item has a completed 3D model segment
    const has3dModel = selectedAssistantItem.segments.some(
      (seg) => seg.kind === "model" && seg.state === "completed",
    );
    if (!has3dModel) {
      setParameters([]);
      setTweakedValues({});
      return;
    }

    let cancelled = false;
    setParametersLoading(true);

    extractParametersApi({
      token,
      contextId: activeContextId,
      assistantItemId: selectedAssistantItem.id,
    })
      .then((result) => {
        if (cancelled) return;
        setParameters(result.parameters);
        // Initialize tweaked values from original parameter values
        const initial: Record<string, number> = {};
        for (const p of result.parameters) {
          initial[p.name] = p.value;
        }
        setTweakedValues(initial);
      })
      .catch(() => {
        if (cancelled) return;
        setParameters([]);
        setTweakedValues({});
      })
      .finally(() => {
        if (!cancelled) setParametersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, activeContextId, selectedAssistantItem?.id, selectedAssistantItem?.segments]);

  async function ensureContextForPrompt(): Promise<string | null> {
    if (!token) {
      return null;
    }

    if (activeContextId) {
      return activeContextId;
    }

    const fallbackName = `New chat ${new Date().toLocaleString()}`;
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

  function buildAttachmentsFromPending(): QueryAttachment[] {
    return pendingFiles
      .filter((f) => f.status === "ready" && f.serverPath)
      .map((f) => ({
        path: f.serverPath!,
        filename: f.file.name,
        mimeType: f.file.type || "application/octet-stream",
        kind: f.kind,
      }));
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

      // Build attachments from already-uploaded pending files (tmp/ paths — backend will relocate)
      const attachments = buildAttachmentsFromPending();

      const result = await submitQuery({
        token,
        contextId: targetContextId,
        prompt: buildEffectivePrompt(trimmedPrompt),
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      // Start listening for streaming events immediately — the backend now returns
      // the assistant item ID before the pipeline runs, so SSE events arrive in real-time
      setStreamingAssistantItemId(result.assistantItem.id);

      // Load items to show the pending assistant item in the timeline
      const loaded = await listChatItems(token, targetContextId);
      setItems(loaded);
      setPendingFiles((prev) => { prev.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); return []; });
      setMobilePane("thread");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
      setOptimisticPrompt(null);
    }
  }

  async function stopQueryAction() {
    if (!token || !streamingAssistantItemId) return;
    try {
      const result = await stopQuery({ token, assistantItemId: streamingAssistantItemId });
      if (!result.wasRunning) {
        // Pipeline not found — server restarted or already finished.
        // Force-clear streaming state so the UI isn't stuck.
        setStreamingAssistantItemId(null);
        streamingActivatedForIdRef.current = null;
      }
    } catch {
      // Network error — force-clear as best effort
      setStreamingAssistantItemId(null);
      streamingActivatedForIdRef.current = null;
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
        trackDownload: true,
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

  function addPendingFiles(files: File[]) {
    if (!token || !user) return;
    const userId = user.id;

    const newPending: PendingFile[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      kind: inferAttachmentKind(file),
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      serverPath: null,
      status: "uploading" as const,
    }));
    setPendingFiles((current) => [...current, ...newPending]);

    // Auto-upload each file to tmp/{userId}/
    for (const pending of newPending) {
      const extension = fileExtension(pending.file.name) || ".bin";
      const tmpPath = `tmp/${userId}/${pending.id}${extension}`;
      fileToBase64(pending.file)
        .then((contentBase64) => uploadFileBase64({ token, path: tmpPath, contentBase64 }))
        .then((saved) => {
          setPendingFiles((current) =>
            current.map((f) => f.id === pending.id ? { ...f, serverPath: saved.path, status: "ready" as const } : f),
          );
        })
        .catch(() => {
          setPendingFiles((current) =>
            current.map((f) => f.id === pending.id ? { ...f, status: "error" as const } : f),
          );
        });
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
      const result = await regenerateQuery({
        token,
        contextId: activeContextId,
        assistantItemId,
      });

      // Start listening for streaming events — same pattern as submitPromptAction.
      // No ref reset needed: streamingActivatedForIdRef is ID-scoped, so the
      // clearing effect won't fire until isStreaming has been true for THIS ID.
      setStreamingAssistantItemId(result.assistantItem.id);

      // Load items to show the pending assistant item in the timeline
      const loaded = await listChatItems(token, activeContextId);
      setItems(loaded);
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function reRenderAction() {
    if (!token || !activeContextId || !selectedAssistantItem) return;

    setReRenderBusy(true);
    setError("");
    setMessage("");
    try {
      await reRenderWithParameters({
        token,
        contextId: activeContextId,
        sourceAssistantItemId: selectedAssistantItem.id,
        parameters: tweakedValues,
      });

      // The 202 response fires before the backend creates new items (fire-and-forget).
      // Set a ref flag so the auto-selection effect picks the latest assistant item
      // when the next SSE-driven refresh brings in the new items.
      selectLatestOnRefreshRef.current = true;
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setReRenderBusy(false);
    }
  }

  async function revertToItemAction(assistantItemId: string) {
    if (!token || !activeContextId) return;

    // Count items after target for confirmation message
    const targetIndex = items.findIndex((i) => i.id === assistantItemId);
    if (targetIndex === -1) return;
    const countAfter = items.length - targetIndex - 1;
    if (countAfter === 0) return;

    const confirmed = window.confirm(t("pages:chat.revertToConfirm", { count: countAfter }));
    if (!confirmed) return;

    setBusyAction("revert");
    setError("");
    setMessage("");
    try {
      await revertToItem({ token, contextId: activeContextId, itemId: assistantItemId });
      await refreshItems();
      setSelectedAssistantItemId(assistantItemId);
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  const mobilePaneTabs = [
    { id: "thread" as const, labelKey: "pages:chat.mobileTabs.thread", icon: MessageSquare },
    { id: "workbench" as const, labelKey: "pages:chat.mobileTabs.model", icon: Box },
  ];

  return (
    <section className="flex h-full flex-col">
      {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {/* Mobile pane toggle (2 tabs: thread + workbench) */}
      <div className="sticky top-0 z-20 border-b border-[hsl(var(--border)_/_0.3)] bg-[hsl(var(--background))] p-1 xl:hidden">
        <div className="grid grid-cols-2 gap-1">
          {mobilePaneTabs.map((tab) => {
            const Icon = tab.icon;
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
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-0">
        <section className={`${mobilePane === "thread" ? "block" : "hidden"} min-w-0 flex-1 xl:block`}>
          <div className="flex h-full flex-col p-3">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--border)_/_0.5)] pb-2">
              <h3 className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                {activeContext ? t("common:labels.conversation") : t("pages:chat.newDraft")}
              </h3>
              <PushToggle token={token} externalSubscribed={pushSubscribed} onSubscribedChange={setPushSubscribed} />
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto pr-1 pt-3">
              {timelineItems.length > visibleTimelineItems.length ? (
                <Button size="sm" variant="outline" onClick={() => setVisibleTimelineCount((current) => current + 80)}>
                  {t("common:actions.showOlderMessages", { count: timelineItems.length - visibleTimelineItems.length })}
                </Button>
              ) : null}

              {timelineItems.length === 0 && !optimisticPrompt ? (
                <>
                  <EmptyState
                    title={t("pages:chat.startModeling")}
                    description={t("pages:chat.startModelingDescription")}
                  />
                  <CapabilityHints className="mb-2" />
                  <ExamplePrompts onSelectPrompt={(text) => setPrompt(text)} />
                </>
              ) : null}

              {(() => {
                const lastAssistantId = [...visibleTimelineItems].reverse().find((i) => i.role === "assistant")?.id ?? null;
                return visibleTimelineItems.map((item) => {
                const isStreamingItem = item.role === "assistant" && item.id === streamingAssistantItemId;
                return (
                  <MessageBubble
                    key={item.id}
                    item={item}
                    isSelected={selectedAssistantItemId === item.id}
                    busyAction={busyAction}
                    token={token}
                    isAdmin={isAdmin}
                    streamingText={isStreamingItem ? streamingText : undefined}
                    streamingError={isStreamingItem ? streamingError : undefined}
                    isStreaming={isStreamingItem ? isStreaming : undefined}
                    queryStateDetail={isStreamingItem ? queryStateDetail : undefined}
                    isLongRunning={isStreamingItem ? isLongRunning : undefined}
                    showEnableNotifications={isStreamingItem ? showEnableNotifications : undefined}
                    busyNotifications={isStreamingItem ? pushBusy : undefined}
                    onEnableNotifications={isStreamingItem ? () => void handleEnableNotifications() : undefined}
                    isLatestAssistant={item.role === "assistant" && item.id === lastAssistantId}
                    isPipelineActive={!!streamingAssistantItemId}
                    onSelect={(itemId) => {
                      setSelectedAssistantItemId(itemId);
                      setMobilePane("workbench");
                    }}
                    onRate={(rateItem, rating) => void rateItemAction(rateItem, rating)}
                    onRegenerate={(assistantItemId) => void regenerateAction(assistantItemId)}
                    onRevertTo={(assistantItemId) => void revertToItemAction(assistantItemId)}
                    onDownloadFile={(filePath) => void downloadFileAction(filePath)}
                    onSelectSuggestion={(s) => setPrompt(s)}
                    scrollSettled={scrollSettled}
                  />
                );
              });
              })()}

              {showTypingIndicator ? (
                <TypingIndicator
                  queryState={queryState}
                  detail={queryStateDetail}
                  isLongRunning={isLongRunning}
                  showEnableNotifications={showEnableNotifications}
                  busyNotifications={pushBusy}
                  onEnableNotifications={() => void handleEnableNotifications()}
                />
              ) : null}

              {optimisticPrompt ? (
                <>
                  <div className="pl-[15%]">
                    <article className="animate-fade-in rounded-lg border border-transparent bg-[hsl(var(--primary)_/_0.08)] p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                          <User className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-semibold uppercase tracking-wide">{t("common:labels.user")}</span>
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{optimisticPrompt}</ReactMarkdown>
                    </article>
                  </div>
                  <div className="pr-[15%]">
                    <article className="animate-fade-in rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 text-sm">
                      <div className="mb-2 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]">
                          <Bot className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-semibold uppercase tracking-wide">{t("common:labels.assistant")}</span>
                      </div>
                      <div className="space-y-2" data-testid="optimistic-pending">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    </article>
                  </div>
                </>
              ) : null}

              <div ref={timelineEndRef} />
            </div>

            <div className="shrink-0 pt-2">
              <PromptComposer
                prompt={prompt}
                onPromptChange={setPrompt}
                pendingFiles={pendingFiles}
                busyAction={busyAction}
                activeContextId={activeContextId}
                isStreaming={isStreaming}
                onSubmit={() => void submitPromptAction()}
                onStop={() => void stopQueryAction()}
                onAttachFiles={addPendingFiles}
                onRemoveFile={(id) => {
                  setPendingFiles((current) => {
                    const removed = current.find((f) => f.id === id);
                    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                    return current.filter((f) => f.id !== id);
                  });
                }}
              />
            </div>
          </div>
        </section>

        <aside className={`${mobilePane === "workbench" ? "block" : "hidden"} w-[380px] shrink-0 border-l border-[hsl(var(--border)_/_0.3)] xl:block`}>
          <WorkbenchPane
            selectedAssistantItem={selectedAssistantItem}
            selectedAssistantFiles={selectedAssistantFiles}
            selectedPreviewFile={selectedPreviewFile}
            busyAction={busyAction}
            token={token}
            parameters={parameters}
            tweakedValues={tweakedValues}
            parametersLoading={parametersLoading}
            reRenderBusy={reRenderBusy}
            onParameterChange={(name, value) => setTweakedValues((prev) => ({ ...prev, [name]: value }))}
            onReRender={() => void reRenderAction()}
            onDownloadFile={(filePath) => void downloadFileAction(filePath)}
          />
        </aside>
      </div>
    </section>
  );
}
