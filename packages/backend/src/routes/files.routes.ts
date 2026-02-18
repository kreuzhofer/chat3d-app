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

    if (relativePath.endsWith(".txt") || relativePath.endsWith(".log") || relativePath.endsWith(".json")) {
      res.type("text/plain");
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
