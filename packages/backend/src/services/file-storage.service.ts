import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export class FileStorageError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.trim() === "") {
    throw new FileStorageError("path is required", 400);
  }
  if (normalized.includes("..")) {
    throw new FileStorageError("Invalid file path", 400);
  }
  return normalized;
}

/**
 * Resolve {rootDir}/{relativePath} and verify it stays within rootDir.
 * No user-scoping — caller is responsible for auth checks.
 */
function resolveStoragePath(relativePath: string): string {
  const safePath = assertSafeRelativePath(relativePath);
  const rootDir = path.resolve(config.storage.rootDir);
  const absolutePath = path.resolve(rootDir, safePath);

  if (!absolutePath.startsWith(`${rootDir}${path.sep}`) && absolutePath !== rootDir) {
    throw new FileStorageError("Invalid file path", 400);
  }

  return absolutePath;
}

// ── Domain-scoped storage (chat/workbench) ───────────────────────────

/**
 * Write a file to the domain-scoped storage layout.
 * `relativePath` is resolved directly under the storage root,
 * e.g. "chat/{contextId}/{itemId}.stl" or "workbench/{categoryId}/{exampleId}.stl".
 */
export async function writeStorageFile(input: {
  relativePath: string;
  contentBase64: string;
}): Promise<{ path: string; sizeBytes: number }> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new FileStorageError("contentBase64 must be valid base64", 400);
  }

  const absolutePath = resolveStoragePath(input.relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    path: assertSafeRelativePath(input.relativePath),
    sizeBytes: buffer.length,
  };
}

/**
 * Read a file from the domain-scoped storage layout.
 */
export async function readStorageFile(input: { relativePath: string }): Promise<Buffer> {
  const absolutePath = resolveStoragePath(input.relativePath);
  try {
    return await readFile(absolutePath);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new FileStorageError("File not found", 404);
    }
    throw error;
  }
}

/**
 * Delete a single file from the domain-scoped storage layout.
 */
export async function deleteStorageFile(input: { relativePath: string }): Promise<void> {
  const absolutePath = resolveStoragePath(input.relativePath);
  try {
    await stat(absolutePath);
    await rm(absolutePath, { force: false });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new FileStorageError("File not found", 404);
    }
    throw error;
  }
}

/**
 * Recursively delete a directory from the domain-scoped storage layout.
 */
export async function deleteStorageDirectory(input: { relativePath: string }): Promise<void> {
  const absolutePath = resolveStoragePath(input.relativePath);
  try {
    await rm(absolutePath, { recursive: true, force: true });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      // Directory already gone — nothing to do
      return;
    }
    throw error;
  }
}

// ── Legacy user-scoped storage (@deprecated) ─────────────────────────

/** @deprecated Use resolveStoragePath with domain-scoped paths instead. */
function resolveUserScopedPath(userId: string, relativePath: string): string {
  const safePath = assertSafeRelativePath(relativePath);
  const rootDir = path.resolve(config.storage.rootDir);
  const absolutePath = path.resolve(rootDir, userId, safePath);

  if (!(absolutePath === rootDir || absolutePath.startsWith(`${rootDir}${path.sep}`))) {
    throw new FileStorageError("Invalid file path", 400);
  }

  return absolutePath;
}

/** @deprecated Use writeStorageFile with domain-scoped paths instead. */
export async function writeUserFile(input: {
  userId: string;
  relativePath: string;
  contentBase64: string;
}) {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new FileStorageError("contentBase64 must be valid base64", 400);
  }

  const absolutePath = resolveUserScopedPath(input.userId, input.relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    path: assertSafeRelativePath(input.relativePath),
    sizeBytes: buffer.length,
  };
}

/** @deprecated Use readStorageFile with domain-scoped paths instead. */
export async function readUserFile(input: { userId: string; relativePath: string }): Promise<Buffer> {
  const absolutePath = resolveUserScopedPath(input.userId, input.relativePath);
  try {
    return await readFile(absolutePath);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new FileStorageError("File not found", 404);
    }
    throw error;
  }
}

/** @deprecated Use deleteStorageFile with domain-scoped paths instead. */
export async function deleteUserFile(input: { userId: string; relativePath: string }) {
  const absolutePath = resolveUserScopedPath(input.userId, input.relativePath);
  try {
    await stat(absolutePath);
    await rm(absolutePath, { force: false });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new FileStorageError("File not found", 404);
    }
    throw error;
  }
}
