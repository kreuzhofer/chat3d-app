import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  deleteStorageFile,
  FileStorageError,
  readStorageFile,
  writeStorageFile,
} from "../services/file-storage.service.js";
import { getOwnedContext } from "../services/chat.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("files");

export const filesRouter = Router();

filesRouter.use(requireAuth);

function readRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim();
}

function sendKnownError(
  res: Parameters<typeof filesRouter.get>[1] extends (req: infer _Req, res: infer Res) => unknown ? Res : never,
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof FileStorageError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: fallbackMessage, detail: String(error) });
}

function inferContentType(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".stl")) return "application/vnd.ms-pki.stl";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "application/step";
  if (lower.endsWith(".3mf")) return "model/3mf";
  if (lower.endsWith(".obj")) return "model/obj";
  if (lower.endsWith(".b123d")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function basename(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "download.bin";
}

/**
 * Parse domain-scoped path and extract the authorization context.
 *
 *   "chat/{contextId}/..."   → { domain: "chat", scope: contextId }
 *   "workbench/..."          → { domain: "workbench" }
 *
 * Returns null if the path doesn't match any known domain prefix.
 */
function parseDomainPath(relativePath: string): { domain: "chat"; scope: string } | { domain: "workbench" } | { domain: "tmp"; scope: string } | null {
  const segments = relativePath.replace(/\\/g, "/").split("/");

  if (segments[0] === "chat" && segments.length >= 3 && segments[1]) {
    return { domain: "chat", scope: segments[1] };
  }

  if (segments[0] === "workbench" && segments.length >= 2) {
    return { domain: "workbench" };
  }

  // tmp/{userId}/... — temporary upload folder, scoped to the authenticated user
  if (segments[0] === "tmp" && segments.length >= 3 && segments[1]) {
    return { domain: "tmp", scope: segments[1] };
  }

  return null;
}

filesRouter.post("/upload", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const relativePath = readRelativePath(req.body?.path);
  const contentBase64 = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";
  if (!relativePath || !contentBase64) {
    res.status(400).json({ error: "path and contentBase64 are required" });
    return;
  }

  // Validate domain-scoped path and authorize
  const domainInfo = parseDomainPath(relativePath);
  if (!domainInfo) {
    res.status(403).json({ error: "Path must start with chat/{contextId}/, workbench/, or tmp/{userId}/" });
    return;
  }

  try {
    if (domainInfo.domain === "chat") {
      await getOwnedContext(authUser.id, domainInfo.scope);
    } else if (domainInfo.domain === "tmp") {
      if (domainInfo.scope !== authUser.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else if (authUser.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const file = await writeStorageFile({ relativePath, contentBase64 });
    res.status(201).json(file);
  } catch (error) {
    sendKnownError(res, error, "Failed to upload file");
  }
});

filesRouter.get("/download", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const relativePath = readRelativePath(req.query.path);
  if (!relativePath) {
    res.status(400).json({ error: "path is required" });
    return;
  }

  // Validate domain-scoped path and authorize
  const domainInfo = parseDomainPath(relativePath);
  if (!domainInfo) {
    res.status(403).json({ error: "Path must start with chat/{contextId}/, workbench/, or tmp/{userId}/" });
    return;
  }

  try {
    if (domainInfo.domain === "chat") {
      await getOwnedContext(authUser.id, domainInfo.scope);
    } else if (domainInfo.domain === "tmp") {
      if (domainInfo.scope !== authUser.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else if (authUser.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const content = await readStorageFile({ relativePath });

    const contentType = inferContentType(relativePath);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${basename(relativePath)}"`);

    // Files at a given path can be overwritten between iterations
    // (e.g. chat/{contextId}/{messageId}.stl).  Force the browser to
    // revalidate on every request so viewers never show stale models.
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    if (contentType.startsWith("text/") || contentType.startsWith("application/json")) {
      res.status(200).send(content.toString("utf8"));
      return;
    }

    res.status(200).send(content);
  } catch (error) {
    sendKnownError(res, error, "Failed to download file");
  }
});

filesRouter.delete("/delete", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const relativePath = readRelativePath(req.query.path);
  if (!relativePath) {
    res.status(400).json({ error: "path is required" });
    return;
  }

  // Validate domain-scoped path and authorize
  const domainInfo = parseDomainPath(relativePath);
  if (!domainInfo) {
    res.status(403).json({ error: "Path must start with chat/{contextId}/ or workbench/" });
    return;
  }

  try {
    if (domainInfo.domain === "chat") {
      await getOwnedContext(authUser.id, domainInfo.scope);
    } else if (domainInfo.domain === "tmp") {
      if (domainInfo.scope !== authUser.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else if (authUser.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await deleteStorageFile({ relativePath });
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete file");
  }
});
