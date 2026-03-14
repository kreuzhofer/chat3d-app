/**
 * Fetches available model IDs from a provider's API.
 * Uses the OpenAI-compatible /v1/models endpoint where supported.
 */

import { getProviderByName } from "./llm-config.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("provider-models");

/** Provider types that support the /v1/models listing endpoint. */
const SUPPORTED_TYPES = new Set(["openai", "deepseek", "xai", "ollama", "openai-compatible"]);

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
  xai: "https://api.x.ai",
};

/**
 * Fetch available model IDs from a provider's /v1/models endpoint.
 * Returns an empty array for unsupported provider types or on error.
 */
export async function fetchProviderModels(providerName: string): Promise<string[]> {
  const provider = await getProviderByName(providerName);
  if (!provider) {
    logger.warn({ providerName }, "provider not found");
    return [];
  }

  const providerType = provider.provider_type ?? providerName;

  if (!SUPPORTED_TYPES.has(providerType)) {
    logger.debug({ providerName, providerType }, "provider type does not support model listing");
    return [];
  }

  // Determine base URL
  const defaultBase = DEFAULT_BASE_URLS[providerType];
  const endpointUrl = provider.endpoint_url;

  if (!endpointUrl && !defaultBase) {
    logger.warn({ providerName, providerType }, "no endpoint URL configured and no default available");
    return [];
  }

  const rawBase = endpointUrl ?? defaultBase!;
  const normalized = rawBase.replace(/\/+$/, "");
  const modelsUrl = normalized.endsWith("/v1")
    ? `${normalized}/models`
    : `${normalized}/v1/models`;

  // Build headers
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = provider.api_key?.trim();
  if (apiKey && apiKey !== "") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    logger.debug({ providerName, modelsUrl }, "fetching provider models");

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn(
        { providerName, status: response.status, statusText: response.statusText },
        "provider models API returned non-OK status",
      );
      return [];
    }

    const body = (await response.json()) as { data?: Array<{ id: string }> };
    const models = Array.isArray(body.data)
      ? body.data.map((m) => m.id).filter(Boolean).sort()
      : [];

    logger.info({ providerName, count: models.length }, "fetched provider models");
    return models;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.warn({ providerName, modelsUrl }, "provider models request timed out");
    } else {
      logger.warn({ providerName, err }, "failed to fetch provider models");
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
