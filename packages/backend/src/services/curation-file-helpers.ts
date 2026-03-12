/**
 * Shared file helpers for curation promotion workflows.
 *
 * Handles finding best assistant items with model files on disk
 * and copying chat files to workbench storage.
 */

import { createLogger } from "../utils/logger.js";
import {
  readStorageFile,
  writeStorageFileFromBuffer,
  storageFileExists,
} from "./file-storage.service.js";

const logger = createLogger("curation-files");

/** All screenshot angles: maps file suffix → DB column on WorkbenchExample. */
export const SCREENSHOT_ANGLES: Array<{
  suffix: string;
  column: keyof CopiedFilePaths;
}> = [
  { suffix: "front", column: "screenshotFront" },
  { suffix: "back", column: "screenshotBack" },
  { suffix: "left", column: "screenshotLeft" },
  { suffix: "right", column: "screenshotRight" },
  { suffix: "top", column: "screenshotTop" },
  { suffix: "bottom", column: "screenshotBottom" },
  { suffix: "ortho_45", column: "screenshotOrtho45" },
  { suffix: "ortho_45_bottom", column: "screenshotOrtho45Bottom" },
  { suffix: "isometric", column: "screenshotIso" },
  { suffix: "isometric_back", column: "screenshotIsoBack" },
];

/** 3D model file extensions to copy. */
export const MODEL_EXTENSIONS = ["stl", "step", "3mf"] as const;

export interface CopiedFilePaths {
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFront: string | null;
  screenshotBack: string | null;
  screenshotLeft: string | null;
  screenshotRight: string | null;
  screenshotTop: string | null;
  screenshotBottom: string | null;
  screenshotOrtho45: string | null;
  screenshotOrtho45Bottom: string | null;
  screenshotIso: string | null;
  screenshotIsoBack: string | null;
}

/**
 * Find the best assistant item by iterating backward through conversation items
 * and checking if model files exist on disk.
 */
export async function findBestAssistantItem(
  contextId: string,
  items: Array<{ id: string; role: string }>,
): Promise<{ id: string } | null> {
  const assistantItems = [...items].reverse().filter((i) => i.role === "assistant");

  for (const item of assistantItems) {
    for (const ext of MODEL_EXTENSIONS) {
      const newPath = `chat/${contextId}/artifacts/${item.id}.${ext}`;
      const oldPath = `chat/${contextId}/${item.id}.${ext}`;
      if (await storageFileExists(newPath) || await storageFileExists(oldPath)) {
        return { id: item.id };
      }
    }
    if (await storageFileExists(`chat/${contextId}/code/${item.id}.b123d`) || await storageFileExists(`chat/${contextId}/${item.id}.b123d`)) {
      return { id: item.id };
    }
  }

  return null;
}

/**
 * Read b123d source code for a chat item, checking new path first then old.
 */
export async function readB123dCode(contextId: string, itemId: string): Promise<string> {
  const b123dNew = `chat/${contextId}/code/${itemId}.b123d`;
  const b123dOld = `chat/${contextId}/${itemId}.b123d`;
  const src = (await storageFileExists(b123dNew)) ? b123dNew : (await storageFileExists(b123dOld)) ? b123dOld : null;
  if (!src) return "";
  return (await readStorageFile({ relativePath: src })).toString("utf-8");
}

/**
 * Copy model files and screenshots from chat storage to workbench storage.
 */
export async function copyFilesToWorkbench(
  contextId: string,
  itemId: string,
  categoryId: string,
  exampleFileId: string,
): Promise<CopiedFilePaths> {
  const srcArtifactPrefix = `chat/${contextId}/artifacts/${itemId}`;
  const srcArtifactPrefixOld = `chat/${contextId}/${itemId}`;
  const srcCodePrefix = `chat/${contextId}/code/${itemId}`;
  const srcCodePrefixOld = `chat/${contextId}/${itemId}`;
  const dstArtifactPrefix = `workbench/${categoryId}/artifacts/${exampleFileId}`;
  const dstCodePrefix = `workbench/${categoryId}/code/${exampleFileId}`;

  const result: CopiedFilePaths = {
    stlPath: null, stepPath: null, threemfPath: null,
    screenshotFront: null, screenshotBack: null, screenshotLeft: null,
    screenshotRight: null, screenshotTop: null, screenshotBottom: null,
    screenshotOrtho45: null, screenshotOrtho45Bottom: null,
    screenshotIso: null, screenshotIsoBack: null,
  };

  // Copy model files
  for (const ext of MODEL_EXTENSIONS) {
    const srcNew = `${srcArtifactPrefix}.${ext}`;
    const srcOld = `${srcArtifactPrefixOld}.${ext}`;
    const src = (await storageFileExists(srcNew)) ? srcNew : (await storageFileExists(srcOld)) ? srcOld : null;
    if (src) {
      const dst = `${dstArtifactPrefix}.${ext}`;
      const buf = await readStorageFile({ relativePath: src });
      await writeStorageFileFromBuffer({ relativePath: dst, content: buf });
      if (ext === "stl") result.stlPath = dst;
      else if (ext === "step") result.stepPath = dst;
      else if (ext === "3mf") result.threemfPath = dst;
      logger.debug({ src, dst }, "copied model file");
    }
  }

  // Copy b123d source
  const b123dSrcNew = `${srcCodePrefix}.b123d`;
  const b123dSrcOld = `${srcCodePrefixOld}.b123d`;
  const b123dSrc = (await storageFileExists(b123dSrcNew)) ? b123dSrcNew : (await storageFileExists(b123dSrcOld)) ? b123dSrcOld : null;
  if (b123dSrc) {
    const b123dDst = `${dstCodePrefix}.b123d`;
    const buf = await readStorageFile({ relativePath: b123dSrc });
    await writeStorageFileFromBuffer({ relativePath: b123dDst, content: buf });
    logger.debug({ src: b123dSrc, dst: b123dDst }, "copied b123d file");
  }

  // Copy screenshots
  for (const { suffix, column } of SCREENSHOT_ANGLES) {
    const srcNew = `${srcArtifactPrefix}-screenshot-${suffix}.png`;
    const srcOld = `${srcArtifactPrefixOld}-screenshot-${suffix}.png`;
    const src = (await storageFileExists(srcNew)) ? srcNew : (await storageFileExists(srcOld)) ? srcOld : null;
    if (src) {
      const dst = `${dstArtifactPrefix}-screenshot-${suffix}.png`;
      const buf = await readStorageFile({ relativePath: src });
      await writeStorageFileFromBuffer({ relativePath: dst, content: buf });
      result[column] = dst;
      logger.debug({ src, dst, angle: suffix }, "copied screenshot");
    }
  }

  return result;
}
