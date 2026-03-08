import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { detectPromptOperations } from "../prompts/system-prompts.js";
import { CurationError, getCandidateDetail } from "./curation.service.js";
import {
  readStorageFile,
  writeStorageFileFromBuffer,
  storageFileExists,
} from "./file-storage.service.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";

const logger = createLogger("curation-promote");

/** All screenshot angles: maps file suffix → DB column on WorkbenchExample. */
const SCREENSHOT_ANGLES: Array<{
  suffix: string;
  column: keyof typeof SCREENSHOT_COLUMN_MAP;
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

// Sentinel object just for the keyof type above
const SCREENSHOT_COLUMN_MAP = {
  screenshotFront: true,
  screenshotBack: true,
  screenshotLeft: true,
  screenshotRight: true,
  screenshotTop: true,
  screenshotBottom: true,
  screenshotOrtho45: true,
  screenshotOrtho45Bottom: true,
  screenshotIso: true,
  screenshotIsoBack: true,
} as const;

/** 3D model file extensions to copy. */
const MODEL_EXTENSIONS = ["stl", "step", "3mf"] as const;

export interface PromotionResult {
  candidateId: string;
  workbenchExampleId: string;
  workbenchPromptId: string;
  categoryId: string;
}

/**
 * Promote a curation candidate to the workbench library.
 *
 * 1. Validates candidate state (must have distilled prompt, not already approved)
 * 2. Finds the best assistant item with model files on disk
 * 3. Copies files from chat/ to workbench/ storage
 * 4. Creates WorkbenchExamplePrompt + WorkbenchExample
 * 5. Copies tags from curation candidate to workbench prompt
 * 6. Generates embedding (best-effort)
 * 7. Updates candidate status to approved
 */
export async function promoteCandidate(candidateId: string): Promise<PromotionResult> {
  // 1. Load candidate detail
  const detail = await getCandidateDetail(candidateId);

  if (!detail.distilledPrompt) {
    throw new CurationError("Candidate has no distilled prompt. Distill the prompt before approving.", 400);
  }

  if (detail.status === "approved") {
    throw new CurationError("Candidate is already approved.", 409);
  }

  // 2. Find the best assistant item with model files on disk
  const contextId = detail.chatContext.id;
  const bestItem = await findBestAssistantItem(contextId, detail.conversationItems);
  if (!bestItem) {
    throw new CurationError("No assistant item with model files found on disk.", 400);
  }

  logger.info({ candidateId, itemId: bestItem.id }, "found best assistant item for promotion");

  // 3. Find or create the "User Generated Models" category
  const category = await prisma.workbenchCategory.findFirst({
    where: { name: "User Generated Models" },
  });
  if (!category) {
    throw new CurationError(
      "User Generated Models category not found. Ensure the Phase 3 migration has been applied.",
      500,
    );
  }

  // 4. Determine next index for the category
  const maxIndexResult = await prisma.workbenchExamplePrompt.aggregate({
    where: { categoryId: category.id },
    _max: { index: true },
  });
  const nextIndex = (maxIndexResult._max.index ?? -1) + 1;

  // 5. Create WorkbenchExamplePrompt
  const prompt = await prisma.workbenchExamplePrompt.create({
    data: {
      categoryId: category.id,
      index: nextIndex,
      prompt: detail.distilledPrompt,
      detectedOperations: [...detectPromptOperations(detail.distilledPrompt)],
    },
  });

  logger.info({ promptId: prompt.id, categoryId: category.id, index: nextIndex }, "created workbench prompt");

  // 6. Copy files from chat/ to workbench/ storage
  const filePaths = await copyFilesToWorkbench(contextId, bestItem.id, category.id, prompt.id);

  // 7. Read b123d code (check new path first, then old)
  let code = "";
  const b123dCodeNew = `chat/${contextId}/code/${bestItem.id}.b123d`;
  const b123dCodeOld = `chat/${contextId}/${bestItem.id}.b123d`;
  const b123dCodeSrc = (await storageFileExists(b123dCodeNew)) ? b123dCodeNew : (await storageFileExists(b123dCodeOld)) ? b123dCodeOld : null;
  if (b123dCodeSrc) {
    const buf = await readStorageFile({ relativePath: b123dCodeSrc });
    code = buf.toString("utf-8");
  }

  // 8. Create WorkbenchExample
  // We use promptId as the exampleId since we created files with that ID
  const example = await prisma.workbenchExample.create({
    data: {
      promptId: prompt.id,
      code: code || "(no code available)",
      renderStatus: "success",
      approvalStatus: "human_approved",
      iteration: 1,
      stlPath: filePaths.stlPath,
      stepPath: filePaths.stepPath,
      threemfPath: filePaths.threemfPath,
      screenshotFront: filePaths.screenshotFront,
      screenshotBack: filePaths.screenshotBack,
      screenshotLeft: filePaths.screenshotLeft,
      screenshotRight: filePaths.screenshotRight,
      screenshotTop: filePaths.screenshotTop,
      screenshotBottom: filePaths.screenshotBottom,
      screenshotOrtho45: filePaths.screenshotOrtho45,
      screenshotOrtho45Bottom: filePaths.screenshotOrtho45Bottom,
      screenshotIso: filePaths.screenshotIso,
      screenshotIsoBack: filePaths.screenshotIsoBack,
    },
  });

  logger.info({ exampleId: example.id }, "created workbench example");

  // 9. Copy tags from curation candidate to workbench prompt
  if (detail.tags.length > 0) {
    await prisma.workbenchPromptTag.createMany({
      data: detail.tags.map((t) => ({
        promptId: prompt.id,
        tagId: t.id,
      })),
      skipDuplicates: true,
    });
    logger.info({ count: detail.tags.length }, "copied tags to workbench prompt");
  }

  // 10. Generate embedding (best-effort)
  try {
    await embedAndStorePrompt(prompt.id, detail.distilledPrompt);
    logger.info({ promptId: prompt.id }, "generated embedding for promoted prompt");
  } catch (err) {
    logger.warn({ err, promptId: prompt.id }, "embedding generation failed — can be backfilled later");
  }

  // 11. Update candidate status
  await prisma.curationCandidate.update({
    where: { id: candidateId },
    data: {
      status: "approved",
      workbenchExampleId: example.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  logger.info({ candidateId, exampleId: example.id }, "candidate promoted to workbench");

  return {
    candidateId,
    workbenchExampleId: example.id,
    workbenchPromptId: prompt.id,
    categoryId: category.id,
  };
}

/**
 * Find the best assistant item by iterating backward through conversation items
 * and checking if model files exist on disk.
 */
async function findBestAssistantItem(
  contextId: string,
  items: Array<{ id: string; role: string }>,
): Promise<{ id: string } | null> {
  const assistantItems = [...items].reverse().filter((i) => i.role === "assistant");

  for (const item of assistantItems) {
    // Check if any model file exists on disk (new paths first, then old)
    for (const ext of MODEL_EXTENSIONS) {
      const newPath = `chat/${contextId}/artifacts/${item.id}.${ext}`;
      const oldPath = `chat/${contextId}/${item.id}.${ext}`;
      if (await storageFileExists(newPath) || await storageFileExists(oldPath)) {
        return { id: item.id };
      }
    }
    // Also check for b123d (new path first, then old)
    if (await storageFileExists(`chat/${contextId}/code/${item.id}.b123d`) || await storageFileExists(`chat/${contextId}/${item.id}.b123d`)) {
      return { id: item.id };
    }
  }

  return null;
}

interface CopiedFilePaths {
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
 * Copy model files and screenshots from chat storage to workbench storage.
 * Uses the promptId as the workbench file identifier (the example ID is not yet known).
 */
async function copyFilesToWorkbench(
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
    stlPath: null,
    stepPath: null,
    threemfPath: null,
    screenshotFront: null,
    screenshotBack: null,
    screenshotLeft: null,
    screenshotRight: null,
    screenshotTop: null,
    screenshotBottom: null,
    screenshotOrtho45: null,
    screenshotOrtho45Bottom: null,
    screenshotIso: null,
    screenshotIsoBack: null,
  };

  // Copy model files (check new path first, then old)
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

  // Copy b123d source (check new path first, then old)
  const b123dSrcNew = `${srcCodePrefix}.b123d`;
  const b123dSrcOld = `${srcCodePrefixOld}.b123d`;
  const b123dSrc = (await storageFileExists(b123dSrcNew)) ? b123dSrcNew : (await storageFileExists(b123dSrcOld)) ? b123dSrcOld : null;
  if (b123dSrc) {
    const b123dDst = `${dstCodePrefix}.b123d`;
    const buf = await readStorageFile({ relativePath: b123dSrc });
    await writeStorageFileFromBuffer({ relativePath: b123dDst, content: buf });
    logger.debug({ src: b123dSrc, dst: b123dDst }, "copied b123d file");
  }

  // Copy screenshots (check new path first, then old)
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
