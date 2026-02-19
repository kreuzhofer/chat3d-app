import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { deleteUserFile, FileStorageError, readUserFile, writeUserFile } from "../services/file-storage.service.js";

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

  try {
    const file = await writeUserFile({
      userId: authUser.id,
      relativePath,
      contentBase64,
    });
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

  try {
    const content = await readUserFile({
      userId: authUser.id,
      relativePath,
    });

    const contentType = inferContentType(relativePath);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${basename(relativePath)}"`);

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

  try {
    await deleteUserFile({
      userId: authUser.id,
      relativePath,
    });
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete file");
  }
});
