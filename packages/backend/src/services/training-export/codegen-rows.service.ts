import { prisma } from "../../db/prisma.js";
import type { ExportRequest } from "./types.js";

export interface CodegenRow {
  exampleId: string;
  promptId: string;
  prompt: string;
  code: string;
  systemPrompt: string;
  category: string;
  evalScore: number | null;
}

export async function fetchCodegenRows(req: ExportRequest): Promise<CodegenRow[]> {
  const { minScore, categoryId, approvalOnly = true } = req;

  const where: Record<string, unknown> = {
    renderStatus: "success",
    experimentRunId: null,
  };
  if (approvalOnly) {
    where.approvalStatus = { in: ["auto_approved", "human_approved"] };
  }
  if (minScore != null) {
    where.evalScore = { gte: minScore };
  }
  if (categoryId) {
    where.promptRef = { categoryId };
  }

  const rows = await prisma.workbenchExample.findMany({
    where,
    select: {
      id: true,
      promptId: true,
      code: true,
      agentSystemPrompt: true,
      evalScore: true,
      promptRef: {
        select: {
          prompt: true,
          category: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { promptRef: { categoryId: "asc" } },
      { promptRef: { index: "asc" } },
      { evalScore: "desc" },
    ],
  });

  const out: CodegenRow[] = [];
  for (const r of rows) {
    if (!r.agentSystemPrompt) continue;
    out.push({
      exampleId: r.id,
      promptId: r.promptId,
      prompt: r.promptRef.prompt,
      code: r.code,
      systemPrompt: r.agentSystemPrompt,
      category: r.promptRef.category.name,
      evalScore: r.evalScore != null ? Number(r.evalScore) : null,
    });
  }
  return out;
}
