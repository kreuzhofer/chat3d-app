import type { ChatItem } from "../../api/chat.api";

export type ChatMessageState = "pending" | "completed" | "error" | "unknown";
export type ChatSegmentKind = "message" | "error" | "meta";

export interface ChatFileEntry {
  path: string;
  filename: string;
}

export interface ChatSegment {
  id: string;
  kind: ChatSegmentKind;
  text: string;
  state: ChatMessageState;
  stateMessage: string;
  files: ChatFileEntry[];
}

export interface ChatTimelineItem {
  id: string;
  role: "user" | "assistant";
  rating: -1 | 0 | 1;
  createdAt: string;
  updatedAt: string;
  segments: ChatSegment[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toMessageState(value: unknown): ChatMessageState {
  if (value === "pending" || value === "completed" || value === "error") {
    return value;
  }
  return "unknown";
}

function toSegmentKind(value: unknown): ChatSegmentKind {
  if (value === "errormessage") {
    return "error";
  }
  if (value === "meta") {
    return "meta";
  }
  return "message";
}

function mapFiles(value: unknown): ChatFileEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const file = asRecord(entry);
      if (!file) {
        return null;
      }

      const path = typeof file.path === "string" ? file.path : "";
      const filename = typeof file.filename === "string" ? file.filename : "";
      if (!path && !filename) {
        return null;
      }

      return {
        path,
        filename: filename || path,
      };
    })
    .filter((entry): entry is ChatFileEntry => entry !== null);
}

function mapSegment(raw: unknown, index: number): ChatSegment {
  const message = asRecord(raw);
  if (!message) {
    return {
      id: `segment-${index}`,
      kind: "message",
      text: "",
      state: "unknown",
      stateMessage: "",
      files: [],
    };
  }

  const id = typeof message.id === "string" ? message.id : `segment-${index}`;
  const text = typeof message.text === "string" ? message.text : "";
  const stateMessage = typeof message.stateMessage === "string" ? message.stateMessage : "";

  return {
    id,
    kind: toSegmentKind(message.itemType),
    text,
    state: toMessageState(message.state),
    stateMessage,
    files: mapFiles(message.files),
  };
}

export function adaptChatItem(item: ChatItem): ChatTimelineItem {
  const segments = Array.isArray(item.messages)
    ? item.messages.map((entry, index) => mapSegment(entry, index))
    : [];

  return {
    id: item.id,
    role: item.role,
    rating: item.rating,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    segments,
  };
}
