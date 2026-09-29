/**
 * Generation over an explicit prompt list (issue #120): another row for each
 * listed prompt, in lanes — the top-up of second generations of corpus
 * prompts when a sitting's gold falls short.
 *
 * A held-out prompt is refused, never silently dropped: the held-out set is
 * cut by prompt (the training export's cut, `heldOutRows`), because a new row
 * of a held-out prompt shares its checklist with the measurement set. The
 * caller learns which ids were refused and sends a clean list.
 */
import { prisma } from "../db/prisma.js";
import { heldOutRows } from "./training-export/judge-sft-held-out.js";
import { launchGenerationBatch, type BatchJobSummary } from "./workbench-batch.service.js";

export class PromptListError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "PromptListError";
  }
}

export async function startPromptListBatch(
  input: { promptIds: string[]; concurrency?: number },
  userId?: string,
): Promise<BatchJobSummary> {
  const ids = input.promptIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new PromptListError("promptIds must be a non-empty list", 400);
  if (new Set(ids).size !== ids.length) throw new PromptListError("promptIds holds duplicates", 400);

  const heldOut = new Set((await heldOutRows()).promptIds);
  const refused = ids.filter((id) => heldOut.has(id));
  if (refused.length > 0) {
    throw new PromptListError(`${refused.length} held-out prompt(s) refused: ${refused.slice(0, 10).join(", ")}${refused.length > 10 ? ", …" : ""}`, 409);
  }

  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { id: { in: ids } },
    select: { id: true, prompt: true },
    orderBy: { id: "asc" },
  });
  if (prompts.length !== ids.length) {
    const found = new Set(prompts.map((p) => p.id));
    const missing = ids.filter((id) => !found.has(id));
    throw new PromptListError(`${missing.length} unknown prompt id(s): ${missing.slice(0, 10).join(", ")}`, 404);
  }

  return launchGenerationBatch({ categoryId: "prompt-list", categoryName: `Prompt list (${prompts.length})` }, prompts, { concurrency: input.concurrency }, userId);
}
