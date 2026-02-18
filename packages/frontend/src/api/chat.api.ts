export type ChatRole = "user" | "assistant";

export interface ChatContext {
  id: string;
  name: string;
  conversationModelId: string | null;
  chat3dModelId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatItem {
  id: string;
  chatContextId: string;
  role: ChatRole;
  messages: unknown[];
  rating: -1 | 0 | 1;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

const CHAT_API_BASE = "/api/chat";

async function requestChatJson<T>(
  token: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${CHAT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Chat request failed";
    throw new Error(message);
  }

  return body as T;
}

export async function listChatContexts(token: string): Promise<ChatContext[]> {
  const response = await requestChatJson<{ contexts: ChatContext[] }>(token, "/contexts", { method: "GET" });
  return Array.isArray(response.contexts) ? response.contexts : [];
}

export function createChatContext(token: string, name: string): Promise<ChatContext> {
  return requestChatJson<ChatContext>(token, "/contexts", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateChatContext(
  token: string,
  contextId: string,
  patch: {
    name?: string;
    conversationModelId?: string | null;
    chat3dModelId?: string | null;
  },
): Promise<ChatContext> {
  return requestChatJson<ChatContext>(token, `/contexts/${encodeURIComponent(contextId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: patch.name,
      conversationModelId: patch.conversationModelId,
      chat3dModelId: patch.chat3dModelId,
    }),
  });
}

export function deleteChatContext(token: string, contextId: string): Promise<void> {
  return requestChatJson<void>(token, `/contexts/${encodeURIComponent(contextId)}`, {
    method: "DELETE",
  });
}

export async function listChatItems(token: string, contextId: string): Promise<ChatItem[]> {
  const response = await requestChatJson<{ items: ChatItem[] }>(
    token,
    `/contexts/${encodeURIComponent(contextId)}/items`,
    {
      method: "GET",
    },
  );
  return Array.isArray(response.items) ? response.items : [];
}

export function createChatItem(input: {
  token: string;
  contextId: string;
  role: ChatRole;
  messages: unknown[];
}): Promise<ChatItem> {
  return requestChatJson<ChatItem>(input.token, `/contexts/${encodeURIComponent(input.contextId)}/items`, {
    method: "POST",
    body: JSON.stringify({
      role: input.role,
      messages: input.messages,
    }),
  });
}

export function updateChatItem(input: {
  token: string;
  contextId: string;
  itemId: string;
  messages?: unknown[];
  rating?: -1 | 0 | 1;
}): Promise<ChatItem> {
  return requestChatJson<ChatItem>(
    input.token,
    `/contexts/${encodeURIComponent(input.contextId)}/items/${encodeURIComponent(input.itemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        messages: input.messages,
        rating: input.rating,
      }),
    },
  );
}

export function deleteChatItem(input: { token: string; contextId: string; itemId: string }): Promise<void> {
  return requestChatJson<void>(
    input.token,
    `/contexts/${encodeURIComponent(input.contextId)}/items/${encodeURIComponent(input.itemId)}`,
    {
      method: "DELETE",
    },
  );
}
