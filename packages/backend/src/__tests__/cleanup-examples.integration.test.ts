import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/prisma.js";
import { cleanupExamplesForPrompt } from "../services/workbench-examples.service.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let categoryId: string | null = null;
let promptId: string | null = null;

async function insertExample(
  promptId: string,
  approvalStatus: "auto_approved" | "human_approved" | "pending" | "rejected",
  evalScore: number,
  createdAtIso: string,
) {
  const row = await prisma.workbenchExample.create({
    data: {
      promptId,
      code: "from build123d import *\nroot_part = Box(10,10,10)\n",
      renderStatus: "success",
      approvalStatus,
      evalScore,
      createdAt: new Date(createdAtIso),
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  // Find the next available rank
  const maxRank = await prisma.workbenchCategory.aggregate({
    _max: { rank: true },
  });
  const nextRank = (maxRank._max.rank ?? 0) + 1;

  const cat = await prisma.workbenchCategory.create({
    data: { name: `cleanup-test-${suffix}`, complexity: 1, description: "test", rank: nextRank },
    select: { id: true },
  });
  categoryId = cat.id;

  const prompt = await prisma.workbenchExamplePrompt.create({
    data: { categoryId: cat.id, index: 0, prompt: "Test prompt for cleanup ordering" },
    select: { id: true },
  });
  promptId = prompt.id;
});

afterAll(async () => {
  if (promptId) {
    await prisma.workbenchExample.deleteMany({ where: { promptId } });
    await prisma.workbenchExamplePrompt.deleteMany({ where: { id: promptId } });
  }
  if (categoryId) {
    await prisma.workbenchCategory.delete({ where: { id: categoryId } });
  }
});

describe("cleanupExamplesForPrompt — prefer='newest-approved'", () => {
  it("keeps the newest auto_approved example, not the highest-scoring older one", async () => {
    const olderHighScore = await insertExample(promptId, "auto_approved", 9.2, "2026-04-03T10:00:00Z");
    const newerLowerScore = await insertExample(promptId, "auto_approved", 8.5, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId, { prefer: "newest-approved" });

    expect(result.keptId).toBe(newerLowerScore);
    expect(result.deleted).toBe(1);

    const remaining = await prisma.workbenchExample.findMany({
      where: { promptId },
      select: { id: true },
    });
    expect(remaining.map(r => r.id)).toEqual([newerLowerScore]);

    await prisma.workbenchExample.delete({ where: { id: newerLowerScore } });
    void olderHighScore;
  });
});

describe("cleanupExamplesForPrompt — default prefer='score'", () => {
  it("keeps the highest-scoring approved example even if older", async () => {
    const olderHighScore = await insertExample(promptId, "auto_approved", 9.2, "2026-04-03T10:00:00Z");
    const newerLowerScore = await insertExample(promptId, "auto_approved", 8.5, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId);

    expect(result.keptId).toBe(olderHighScore);
    expect(result.deleted).toBe(1);

    await prisma.workbenchExample.delete({ where: { id: olderHighScore } });
    void newerLowerScore;
  });
});

describe("cleanupExamplesForPrompt — prefer='newest-approved' fallback when no approved", () => {
  it("falls back to score ordering when no example is approved", async () => {
    const pendingHigh = await insertExample(promptId, "pending", 7.0, "2026-04-03T10:00:00Z");
    const pendingLow = await insertExample(promptId, "pending", 6.0, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId, { prefer: "newest-approved" });

    expect(result.keptId).toBe(pendingHigh);
    expect(result.deleted).toBe(1);

    await prisma.workbenchExample.delete({ where: { id: pendingHigh } });
    void pendingLow;
  });
});
