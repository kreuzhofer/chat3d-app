export interface LlmModel {
  id: string;
  provider: string;
  stage: "conversation" | "codegen";
  modelName: string;
}

export interface QuerySubmitResult {
  contextId: string;
  userItemId: string;
  assistantItem: {
    id: string;
    chatContextId: string;
    role: "assistant";
    messages: unknown[];
  };
  generatedFiles: Array<{
    path: string;
    filename: string;
  }>;
  llm: {
    conversationModel: string;
    codegenModel: string;
  };
  artifact?: {
    previewStatus: "ready" | "downgraded";
    detail: string;
    previewFilePath?: string | null;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  renderer: string;
}

export interface QueryAttachment {
  path: string;
  filename: string;
  mimeType: string;
  kind: "file" | "image";
}

/** A file selected by the user, being uploaded or ready. */
export interface PendingFile {
  /** Unique client-side ID for keying and removal. */
  id: string;
  file: File;
  kind: "image" | "file";
  /** Local blob URL for image preview (revoke on removal). */
  previewUrl: string | null;
  /** Server storage path, set once upload completes. */
  serverPath: string | null;
  status: "uploading" | "ready" | "error";
}

const LLM_API_BASE = "/api/llm";
const QUERY_API_BASE = "/api/query";

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Request failed";
    throw new Error(message);
  }
  return body as T;
}

export async function listLlmModels(token: string): Promise<LlmModel[]> {
  const response = await requestJson<{ models: LlmModel[] }>(`${LLM_API_BASE}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return Array.isArray(response.models) ? response.models : [];
}

export function submitQuery(input: {
  token: string;
  contextId: string;
  prompt: string;
  attachments?: QueryAttachment[];
}): Promise<QuerySubmitResult> {
  const payload: {
    contextId: string;
    prompt: string;
    attachments?: QueryAttachment[];
  } = {
    contextId: input.contextId,
    prompt: input.prompt,
  };
  if (Array.isArray(input.attachments) && input.attachments.length > 0) {
    payload.attachments = input.attachments;
  }

  return requestJson<QuerySubmitResult>(`${QUERY_API_BASE}/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function regenerateQuery(input: {
  token: string;
  contextId: string;
  assistantItemId: string;
}): Promise<QuerySubmitResult> {
  return requestJson<QuerySubmitResult>(`${QUERY_API_BASE}/regenerate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contextId: input.contextId,
      assistantItemId: input.assistantItemId,
    }),
  });
}

export function stopQuery(input: {
  token: string;
  assistantItemId: string;
}): Promise<{ ok: boolean; wasRunning: boolean }> {
  return requestJson<{ ok: boolean; wasRunning: boolean }>(`${QUERY_API_BASE}/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assistantItemId: input.assistantItemId }),
  });
}

export interface ExtractedParameter {
  name: string;
  value: number;
  line: number;
  description: string | null;
}

export function extractParameters(input: {
  token: string;
  contextId: string;
  assistantItemId: string;
}): Promise<{ parameters: ExtractedParameter[] }> {
  return requestJson<{ parameters: ExtractedParameter[] }>(
    `${QUERY_API_BASE}/parameters/${encodeURIComponent(input.contextId)}/${encodeURIComponent(input.assistantItemId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
      },
    },
  );
}

export function reRenderWithParameters(input: {
  token: string;
  contextId: string;
  sourceAssistantItemId: string;
  parameters: Record<string, number>;
}): Promise<{ contextId: string; sourceAssistantItemId: string; status: string }> {
  return requestJson<{ contextId: string; sourceAssistantItemId: string; status: string }>(
    `${QUERY_API_BASE}/re-render`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contextId: input.contextId,
        sourceAssistantItemId: input.sourceAssistantItemId,
        parameters: input.parameters,
      }),
    },
  );
}
