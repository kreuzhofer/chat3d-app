import type { ChatItem } from "../../api/chat.api";

export type ChatMessageState = "pending" | "completed" | "error" | "unknown";
export type ChatSegmentKind = "message" | "error" | "meta" | "model" | "attachment";

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
  attachmentPath: string;
  attachmentFilename: string;
  attachmentMimeType: string;
  attachmentKind: "file" | "image";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  } | null;
  artifact: {
    previewStatus: "ready" | "downgraded";
    detail: string;
  } | null;
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
  if (value === "3dmodel") {
    return "model";
  }
  if (value === "errormessage") {
    return "error";
  }
  if (value === "attachment") {
    return "attachment";
  }
  if (value === "meta") {
    return "meta";
  }
  return "message";
}

function mapUsage(value: unknown): ChatSegment["usage"] {
  const usage = asRecord(value);
  if (!usage) {
    return null;
  }

  const inputTokens = Number(usage.inputTokens);
  const outputTokens = Number(usage.outputTokens);
  const totalTokens = Number(usage.totalTokens);
  const estimatedCostUsd = Number(usage.estimatedCostUsd);
  if (
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(totalTokens) ||
    !Number.isFinite(estimatedCostUsd)
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
  };
}

function mapArtifact(value: unknown): ChatSegment["artifact"] {
  const artifact = asRecord(value);
  if (!artifact) {
    return null;
  }

  const previewStatus =
    artifact.previewStatus === "ready" || artifact.previewStatus === "downgraded"
      ? artifact.previewStatus
      : null;
  const detail = typeof artifact.detail === "string" ? artifact.detail : "";
  if (!previewStatus) {
    return null;
  }

  return {
    previewStatus,
    detail,
  };
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
      attachmentPath: "",
      attachmentFilename: "",
      attachmentMimeType: "",
      attachmentKind: "file",
      usage: null,
      artifact: null,
      files: [],
    };
  }

  const id = typeof message.id === "string" ? message.id : `segment-${index}`;
  const text = typeof message.text === "string" ? message.text : "";
  const stateMessage = typeof message.stateMessage === "string" ? message.stateMessage : "";
  const attachmentPath = typeof message.attachment === "string" ? message.attachment : "";
  const attachmentFilename = typeof message.filename === "string" ? message.filename : "";
  const attachmentMimeType = typeof message.mimeType === "string" ? message.mimeType : "";
  const attachmentKind = message.attachmentKind === "image" ? "image" : "file";

  return {
    id,
    kind: toSegmentKind(message.itemType),
    text,
    state: toMessageState(message.state),
    stateMessage,
    attachmentPath,
    attachmentFilename,
    attachmentMimeType,
    attachmentKind,
    usage: mapUsage(message.usage),
    artifact: mapArtifact(message.artifact),
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
