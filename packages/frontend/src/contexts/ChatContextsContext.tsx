import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createChatContext,
  deleteChatContext,
  listChatContexts,
  updateChatContext,
  type ChatContext,
} from "../api/chat.api";
import { useAuth } from "../hooks/useAuth";

/* ── Time-bucket types ────────────────────────────────────────────────── */

export type ContextBucket =
  | "Today"
  | "Yesterday"
  | "Previous 7 Days"
  | "Previous 30 Days"
  | string; // month names for older entries

function contextBucketLabel(updatedAt: string): ContextBucket {
  const now = new Date();
  const updated = new Date(updatedAt);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (updated >= startOfToday) return "Today";
  if (updated >= startOfYesterday) return "Yesterday";
  if (updated >= sevenDaysAgo) return "Previous 7 Days";
  if (updated >= thirtyDaysAgo) return "Previous 30 Days";

  // Older: group by month name
  return updated.toLocaleString("default", { month: "long", year: "numeric" });
}

/** Ordered bucket keys for stable rendering. */
const FIXED_BUCKETS: ContextBucket[] = ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days"];

function groupContexts(contexts: ChatContext[]): { bucket: ContextBucket; items: ChatContext[] }[] {
  const bucketMap = new Map<ContextBucket, ChatContext[]>();

  for (const context of contexts) {
    const bucket = contextBucketLabel(context.updatedAt);
    const existing = bucketMap.get(bucket);
    if (existing) {
      existing.push(context);
    } else {
      bucketMap.set(bucket, [context]);
    }
  }

  // Sort items within each bucket by updatedAt descending
  for (const items of bucketMap.values()) {
    items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  // Build ordered result: fixed buckets first, then month buckets in chronological order
  const result: { bucket: ContextBucket; items: ChatContext[] }[] = [];

  for (const bucket of FIXED_BUCKETS) {
    const items = bucketMap.get(bucket);
    if (items && items.length > 0) {
      result.push({ bucket, items });
      bucketMap.delete(bucket);
    }
  }

  // Remaining buckets are month names — sort them newest first
  const monthBuckets = [...bucketMap.entries()];
  monthBuckets.sort((a, b) => {
    const aDate = Date.parse(a[1][0].updatedAt);
    const bDate = Date.parse(b[1][0].updatedAt);
    return bDate - aDate;
  });
  for (const [bucket, items] of monthBuckets) {
    result.push({ bucket, items });
  }

  return result;
}

/* ── Context value ────────────────────────────────────────────────────── */

export interface ChatContextsContextValue {
  contexts: ChatContext[];
  groupedContexts: { bucket: ContextBucket; items: ChatContext[] }[];
  activeContextId: string | null;
  isLoading: boolean;
  busyAction: string | null;
  refreshContexts: () => Promise<void>;
  createContext: (name?: string) => Promise<ChatContext | null>;
  renameContext: (context: ChatContext, newName: string) => Promise<void>;
  deleteContext: (context: ChatContext) => Promise<void>;
}

const ChatContextsCtx = createContext<ChatContextsContextValue | undefined>(undefined);

export function ChatContextsProvider({ children }: PropsWithChildren) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isChatRoute =
    location.pathname === "/chat" ||
    location.pathname === "/chat/new" ||
    location.pathname.startsWith("/chat/");

  const isDraftRoute = location.pathname === "/chat" || location.pathname === "/chat/new";

  // Parse contextId from URL without useParams (provider sits above Routes)
  const contextIdFromPath = useMemo(() => {
    const match = location.pathname.match(/^\/chat\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const activeContextId = isChatRoute && !isDraftRoute ? contextIdFromPath : null;

  const groupedContexts = useMemo(() => groupContexts(contexts), [contexts]);

  const refreshContexts = useCallback(async () => {
    if (!token) {
      setContexts([]);
      setIsLoading(false);
      return;
    }

    try {
      const loaded = await listChatContexts(token);
      setContexts(loaded);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Load contexts on mount and when token changes
  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    const load = async () => {
      if (!token) {
        if (mounted) {
          setContexts([]);
          setIsLoading(false);
        }
        return;
      }

      try {
        const loaded = await listChatContexts(token);
        if (mounted) setContexts(loaded);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [token]);

  const createContextAction = useCallback(
    async (name?: string): Promise<ChatContext | null> => {
      if (!token) return null;
      const contextName = name?.trim() || `New chat ${new Date().toLocaleString()}`;
      setBusyAction("create-context");
      try {
        const created = await createChatContext(token, contextName);
        await refreshContexts();
        return created;
      } finally {
        setBusyAction(null);
      }
    },
    [token, refreshContexts],
  );

  const renameContextAction = useCallback(
    async (context: ChatContext, newName: string): Promise<void> => {
      if (!token) return;
      const trimmed = newName.trim();
      if (!trimmed) return;

      setBusyAction(`rename-${context.id}`);
      try {
        await updateChatContext(token, context.id, { name: trimmed });
        await refreshContexts();
      } finally {
        setBusyAction(null);
      }
    },
    [token, refreshContexts],
  );

  const deleteContextAction = useCallback(
    async (context: ChatContext): Promise<void> => {
      if (!token) return;

      setBusyAction(`delete-${context.id}`);
      try {
        await deleteChatContext(token, context.id);
        if (activeContextId === context.id) {
          navigate("/chat", { replace: true });
        }
        await refreshContexts();
      } finally {
        setBusyAction(null);
      }
    },
    [token, activeContextId, navigate, refreshContexts],
  );

  const value = useMemo<ChatContextsContextValue>(
    () => ({
      contexts,
      groupedContexts,
      activeContextId,
      isLoading,
      busyAction,
      refreshContexts,
      createContext: createContextAction,
      renameContext: renameContextAction,
      deleteContext: deleteContextAction,
    }),
    [
      contexts,
      groupedContexts,
      activeContextId,
      isLoading,
      busyAction,
      refreshContexts,
      createContextAction,
      renameContextAction,
      deleteContextAction,
    ],
  );

  return <ChatContextsCtx.Provider value={value}>{children}</ChatContextsCtx.Provider>;
}

export function useChatContextsContext(): ChatContextsContextValue {
  const context = useContext(ChatContextsCtx);
  if (!context) {
    throw new Error("useChatContextsContext must be used within ChatContextsProvider");
  }
  return context;
}
