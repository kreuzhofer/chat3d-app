/**
 * Ollama Vision Fetch Wrapper
 *
 * Ollama's OpenAI-compatible endpoint (/v1/chat/completions) returns empty
 * responses for multi-image vision requests. This custom fetch wrapper detects
 * image content in the request and routes it through the native Ollama API
 * (/api/chat) instead, translating the request/response format.
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("ollama-vision");

interface OaiMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface OaiRequestBody {
  model: string;
  messages: OaiMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * Returns true if the request body contains image_url content parts.
 */
function hasImageContent(body: OaiRequestBody): boolean {
  return body.messages?.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === "image_url" && part.image_url?.url),
  ) ?? false;
}

/**
 * Convert OpenAI-format messages to Ollama native format.
 * In Ollama native API, images are passed as base64 strings in an `images` array
 * on the message object, not as content parts.
 */
function convertToOllamaMessages(messages: OaiMessage[]): Array<{
  role: string;
  content: string;
  images?: string[];
}> {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    // Extract text and images from content parts
    const textParts: string[] = [];
    const images: string[] = [];

    for (const part of msg.content) {
      if (part.type === "text" && part.text) {
        textParts.push(part.text);
      } else if (part.type === "image_url" && part.image_url?.url) {
        // Strip data URI prefix to get raw base64
        const url = part.image_url.url;
        const b64 = url.startsWith("data:")
          ? url.replace(/^data:image\/[^;]+;base64,/, "")
          : url;
        images.push(b64);
      }
    }

    return {
      role: msg.role,
      content: textParts.join("\n"),
      ...(images.length > 0 ? { images } : {}),
    };
  });
}

/**
 * Create a custom fetch function that routes vision requests through
 * the native Ollama /api/chat endpoint instead of /v1/chat/completions.
 *
 * Non-vision requests pass through to the standard OpenAI-compatible endpoint.
 */
export function createOllamaVisionFetch(
  ollamaBaseUrl: string,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only intercept POST requests with a body
    if (!init?.body || typeof init.body !== "string") {
      return globalThis.fetch(input, init);
    }

    let body: OaiRequestBody;
    try {
      body = JSON.parse(init.body);
    } catch {
      return globalThis.fetch(input, init);
    }

    // Pass through non-vision requests
    if (!hasImageContent(body)) {
      return globalThis.fetch(input, init);
    }

    logger.debug(
      { model: body.model, messageCount: body.messages.length },
      "routing vision request through native Ollama API",
    );

    // Build native Ollama request.
    // 1. Disable thinking mode — Qwen3's thinking consumes the entire token
    //    budget on complex multi-image prompts, leaving nothing for the response.
    // 2. Increase num_predict — even with think:false, some models still use
    //    internal reasoning tokens. 8192 gives ample room for think + response.
    const ollamaMessages = convertToOllamaMessages(body.messages);
    const requestedTokens = body.max_tokens ?? 1024;
    const ollamaBody = {
      model: body.model,
      messages: ollamaMessages,
      stream: false,
      think: false,
      options: {
        ...(body.temperature != null ? { temperature: body.temperature } : {}),
        num_predict: Math.max(requestedTokens, 8192),
      },
    };

    logger.info(
      { model: ollamaBody.model, think: ollamaBody.think, numPredict: ollamaBody.options?.num_predict, msgCount: ollamaBody.messages.length },
      "sending request to Ollama native API",
    );

    const nativeResponse = await globalThis.fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaBody),
    });

    const nativeBody = await nativeResponse.json();

    if (nativeBody.error) {
      logger.warn({ error: nativeBody.error }, "Ollama native API returned error");
      // Return error in OpenAI format
      return new Response(
        JSON.stringify({ error: { message: nativeBody.error, type: "api_error" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Convert Ollama native response to OpenAI format.
    // Strip <think>...</think> blocks from Qwen3 thinking mode responses.
    let content = nativeBody.message?.content ?? "";
    const rawLength = content.length;
    if (content.includes("<think>")) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      logger.info({ rawLength, strippedLength: content.length }, "stripped thinking tags from response");
    }
    if (!content && rawLength === 0) {
      logger.warn(
        { evalCount: nativeBody.eval_count, promptEvalCount: nativeBody.prompt_eval_count, done: nativeBody.done },
        "Ollama returned empty content — model may need more tokens or failed to generate",
      );
    }
    const oaiResponse = {
      id: `chatcmpl-ollama-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: nativeBody.done ? "stop" : "length",
        },
      ],
      usage: {
        prompt_tokens: nativeBody.prompt_eval_count ?? 0,
        completion_tokens: nativeBody.eval_count ?? 0,
        total_tokens: (nativeBody.prompt_eval_count ?? 0) + (nativeBody.eval_count ?? 0),
      },
    };

    return new Response(JSON.stringify(oaiResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
