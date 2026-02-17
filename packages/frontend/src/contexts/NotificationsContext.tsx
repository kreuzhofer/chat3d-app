import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { fetchNotificationReplay } from "../api/events.api";
import { useAuth } from "../hooks/useAuth";
import { type SseMessage, useSSE } from "../hooks/useSSE";

export interface NotificationRecord {
  id: number;
  userId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt?: string | null;
}

interface NotificationsContextValue {
  notifications: NotificationRecord[];
  unreadCount: number;
  connectionState: "idle" | "connecting" | "open" | "closed" | "error";
  refreshReplay: () => Promise<void>;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

function mapSseToNotification(message: SseMessage): NotificationRecord {
  return {
    id: message.id,
    eventType: message.eventType,
    payload: message.payload,
    createdAt: message.createdAt,
    readAt: null,
  };
}

export function NotificationsProvider({ children }: PropsWithChildren) {
  const { token, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const addNotification = useCallback((record: NotificationRecord) => {
    setNotifications((existing) => {
      const withoutDuplicate = existing.filter((item) => item.id !== record.id);
      return [record, ...withoutDuplicate].sort((a, b) => b.id - a.id);
    });
  }, []);

  const refreshReplay = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      return;
    }

    const latestSeenId = notifications[0]?.id;
    const replay = await fetchNotificationReplay(token, latestSeenId);

    if (replay.length === 0) {
      return;
    }

    setNotifications((existing) => {
      const byId = new Map(existing.map((item) => [item.id, item]));
      for (const item of replay) {
        byId.set(item.id, item);
      }
      return [...byId.values()].sort((a, b) => b.id - a.id);
    });
  }, [notifications, token]);

  const onStreamMessage = useCallback(
    (message: SseMessage) => {
      addNotification(mapSseToNotification(message));
    },
    [addNotification],
  );

  const { state: connectionState } = useSSE({
    token,
    enabled: isAuthenticated,
    onMessage: onStreamMessage,
  });

  const markAllRead = useCallback(() => {
    setNotifications((existing) => existing.map((item) => ({ ...item, readAt: new Date().toISOString() })));
  }, []);

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.readAt ? 0 : 1), 0),
    [notifications],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unreadCount,
      connectionState,
      refreshReplay,
      markAllRead,
    }),
    [connectionState, markAllRead, notifications, refreshReplay, unreadCount],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}
