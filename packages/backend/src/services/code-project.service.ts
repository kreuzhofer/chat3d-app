/**
 * Code Project Service
 *
 * Tracks the current working code per chat context and maintains
 * a version history. Replaces fragile findMostRecentCode() approach
 * with deterministic project state.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("code-project");

export interface CodeProject {
  id: string;
  chatContextId: string;
  currentCode: string;
  currentFiles: Record<string, string> | null;
  lastRenderedItemId: string | null;
  fileCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodeProjectVersion {
  id: string;
  projectId: string;
  chatItemId: string | null;
  code: string;
  versionNumber: number;
  createdAt: Date;
}

/**
 * Get or create a code project for a chat context.
 */
export async function getOrCreateProject(contextId: string): Promise<CodeProject> {
  const existing = await prisma.codeProject.findUnique({
    where: { chatContextId: contextId },
  });
  if (existing) return existing as unknown as CodeProject;

  const created = await prisma.codeProject.create({
    data: { chatContextId: contextId },
  });
  logger.info({ contextId, projectId: created.id }, "created new code project");
  return created as unknown as CodeProject;
}

/**
 * Update the project's current code and create a version entry.
 * Called after a successful render.
 */
export async function updateProjectCode(
  contextId: string,
  code: string,
  chatItemId: string,
): Promise<void> {
  const project = await getOrCreateProject(contextId);

  // Determine next version number
  const lastVersion = await prisma.codeProjectVersion.findFirst({
    where: { projectId: project.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;

  await prisma.$transaction([
    prisma.codeProject.update({
      where: { id: project.id },
      data: {
        currentCode: code,
        lastRenderedItemId: chatItemId,
        updatedAt: new Date(),
      },
    }),
    prisma.codeProjectVersion.create({
      data: {
        projectId: project.id,
        chatItemId,
        code,
        versionNumber: nextVersion,
      },
    }),
  ]);

  logger.info({ contextId, projectId: project.id, version: nextVersion, codeLength: code.length }, "project code updated");
}

/**
 * Get the current working code for a chat context.
 * Returns null if no project exists yet.
 */
export async function getProjectCode(contextId: string): Promise<string | null> {
  const project = await prisma.codeProject.findUnique({
    where: { chatContextId: contextId },
    select: { currentCode: true },
  });
  if (!project || !project.currentCode) return null;
  return project.currentCode;
}

/**
 * Update the project with a multi-file project from agent mode.
 * Stores both main.py code (in currentCode) and all files (in currentFiles JSONB).
 */
export async function updateProjectFiles(
  contextId: string,
  files: Array<{ path: string; content: string }>,
  chatItemId: string,
): Promise<void> {
  const project = await getOrCreateProject(contextId);

  // Build file map
  const fileMap: Record<string, string> = {};
  for (const f of files) {
    fileMap[f.path] = f.content;
  }

  // Main code is always main.py
  const mainCode = fileMap["main.py"] ?? "";

  const lastVersion = await prisma.codeProjectVersion.findFirst({
    where: { projectId: project.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;

  await prisma.$transaction([
    prisma.codeProject.update({
      where: { id: project.id },
      data: {
        currentCode: mainCode,
        currentFiles: files.length > 1 ? fileMap : Prisma.JsonNull,
        fileCount: files.length,
        lastRenderedItemId: chatItemId,
        updatedAt: new Date(),
      },
    }),
    prisma.codeProjectVersion.create({
      data: {
        projectId: project.id,
        chatItemId,
        code: mainCode,
        versionNumber: nextVersion,
      },
    }),
  ]);

  logger.info({ contextId, projectId: project.id, version: nextVersion, fileCount: files.length }, "project files updated");
}

/**
 * Get the current project files for a chat context.
 * Returns null if no project exists.
 * Returns a file map if multi-file, or { "main.py": code } for single-file.
 */
export async function getProjectFiles(contextId: string): Promise<Record<string, string> | null> {
  const project = await prisma.codeProject.findUnique({
    where: { chatContextId: contextId },
    select: { currentCode: true, currentFiles: true },
  });
  if (!project || !project.currentCode) return null;

  if (project.currentFiles && typeof project.currentFiles === "object") {
    return project.currentFiles as Record<string, string>;
  }

  return { "main.py": project.currentCode };
}

/**
 * Get all code versions for a chat context.
 */
export async function getProjectVersions(contextId: string): Promise<CodeProjectVersion[]> {
  const project = await prisma.codeProject.findUnique({
    where: { chatContextId: contextId },
    select: { id: true },
  });
  if (!project) return [];

  return prisma.codeProjectVersion.findMany({
    where: { projectId: project.id },
    orderBy: { versionNumber: "asc" },
  });
}
