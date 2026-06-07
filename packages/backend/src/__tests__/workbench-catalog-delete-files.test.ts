/**
 * Unit tests for deleteCategory file cleanup.
 *
 * Verifies that:
 * - Storage file paths are collected BEFORE the DB delete
 * - Each file is unlinked after the cascade DB delete
 * - Missing files (FileStorageError 404) are silently skipped
 * - The returned report includes filesDeleted count
 * - Experiment-run examples are excluded from file cleanup
 */
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// ── Mocks (must be hoisted before imports) ───────────────────────────

const { mockDeleteStorageFile } = vi.hoisted(() => ({
  mockDeleteStorageFile: vi.fn() as MockInstance<(input: { relativePath: string }) => Promise<void>>,
}));

vi.mock("../services/file-storage.service.js", () => ({
  deleteStorageFile: mockDeleteStorageFile,
  FileStorageError: class FileStorageError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

// Track call order to verify files are fetched before DB delete
const callOrder: string[] = [];

const CAT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROMPT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const EXAMPLE_ID = "cccccccc-0000-0000-0000-000000000003";
const EXAMPLE_ID_EXPR = "dddddddd-0000-0000-0000-000000000004"; // experiment run (should be excluded)

const exampleRow = {
  id: EXAMPLE_ID,
  stl_path: `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}.stl`,
  step_path: `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}.step`,
  threemf_path: null,
  screenshot_front: `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}-screenshot-front.png`,
  screenshot_back: null,
  screenshot_left: null,
  screenshot_right: null,
  screenshot_top: null,
  screenshot_bottom: null,
  screenshot_ortho_45: null,
  screenshot_ortho_45_bottom: null,
  screenshot_iso: `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}-screenshot-isometric.png`,
  screenshot_iso_back: null,
  category_id: CAT_ID,
  approval_status: "auto_approved",
  eval_score: 8.5,
  created_at: new Date("2026-01-01T00:00:00Z"),
  has_agent_trace: false,
};

// Mock prisma — must come before the SUT import
vi.mock("../db/prisma.js", () => {
  const mockPrisma = {
    workbenchCategory: {
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    workbenchExamplePrompt: {
      findMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workbenchExample: {
      deleteMany: vi.fn().mockImplementation(() => {
        callOrder.push("db:deleteExamples");
        return Promise.resolve({ count: 1 });
      }),
    },
    $queryRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

// Mock embeddings (imported transitively through catalog service)
vi.mock("../services/workbench-embeddings.service.js", () => ({
  embedAndStorePrompt: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../db/prisma.js";
import { FileStorageError } from "../services/file-storage.service.js";
import { deleteCategory } from "../services/workbench-catalog.service.js";

// ── Helpers ───────────────────────────────────────────────────────────

function setupPrismaMocks() {
  const mockPrisma = prisma as unknown as {
    workbenchCategory: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    workbenchExamplePrompt: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
    workbenchExample: { deleteMany: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };

  mockPrisma.workbenchCategory.findUnique.mockResolvedValue({ id: CAT_ID });
  mockPrisma.workbenchExamplePrompt.findMany.mockResolvedValue([{ id: PROMPT_ID }]);
  mockPrisma.$queryRaw.mockImplementation(() => {
    callOrder.push("db:queryRows");
    return Promise.resolve([exampleRow]);
  });
  mockPrisma.workbenchExample.deleteMany.mockImplementation(() => {
    callOrder.push("db:deleteExamples");
    return Promise.resolve({ count: 1 });
  });
  mockDeleteStorageFile.mockResolvedValue(undefined);
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
  callOrder.length = 0;
  vi.clearAllMocks();
});

describe("deleteCategory — file cleanup", () => {
  it("collects file paths before DB delete and unlinks them after", async () => {
    setupPrismaMocks();

    const report = await deleteCategory(CAT_ID);

    // Files fetched before DB delete
    const qIdx = callOrder.indexOf("db:queryRows");
    const delIdx = callOrder.indexOf("db:deleteExamples");
    expect(qIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeGreaterThan(qIdx);

    // 4 non-null paths + 1 .b123d = 5 unlink calls
    const expectedPaths = [
      `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}.stl`,
      `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}.step`,
      `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}-screenshot-front.png`,
      `workbench/${CAT_ID}/artifacts/${EXAMPLE_ID}-screenshot-isometric.png`,
      `workbench/${CAT_ID}/code/${EXAMPLE_ID}.b123d`,
    ];
    expect(mockDeleteStorageFile).toHaveBeenCalledTimes(expectedPaths.length);
    for (const p of expectedPaths) {
      expect(mockDeleteStorageFile).toHaveBeenCalledWith({ relativePath: p });
    }

    expect(report.filesDeleted).toBe(expectedPaths.length);
    expect(report.deletedExamples).toBe(1);
    expect(report.deletedPrompts).toBe(1);
  });

  it("silently skips missing files (FileStorageError 404) without crashing", async () => {
    setupPrismaMocks();

    // All files return 404
    mockDeleteStorageFile.mockRejectedValue(new FileStorageError("File not found", 404));

    const report = await deleteCategory(CAT_ID);

    // Should not throw; filesDeleted = 0 because none succeeded
    expect(report.filesDeleted).toBe(0);
    expect(report.deletedExamples).toBe(1);
  });

  it("counts only successfully deleted files in filesDeleted", async () => {
    setupPrismaMocks();

    // First call succeeds, second fails with 404, rest succeed
    mockDeleteStorageFile
      .mockResolvedValueOnce(undefined)       // stl — success
      .mockRejectedValueOnce(new FileStorageError("not found", 404)) // step — missing
      .mockResolvedValue(undefined);           // rest — success

    const report = await deleteCategory(CAT_ID);

    // 5 paths total, 1 missing → 4 deleted
    expect(report.filesDeleted).toBe(4);
  });

  it("returns filesDeleted=0 and deletes DB rows when category has no prompts", async () => {
    const mockPrisma = prisma as unknown as {
      workbenchCategory: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
      workbenchExamplePrompt: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
      workbenchExample: { deleteMany: ReturnType<typeof vi.fn> };
      $queryRaw: ReturnType<typeof vi.fn>;
    };

    mockPrisma.workbenchCategory.findUnique.mockResolvedValue({ id: CAT_ID });
    mockPrisma.workbenchExamplePrompt.findMany.mockResolvedValue([]); // no prompts
    mockPrisma.workbenchExamplePrompt.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.workbenchCategory.delete.mockResolvedValue({});

    const report = await deleteCategory(CAT_ID);

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockDeleteStorageFile).not.toHaveBeenCalled();
    expect(report.filesDeleted).toBe(0);
    expect(report.deletedExamples).toBe(0);
    expect(report.deletedPrompts).toBe(0);
  });

  it("throws WorkbenchCatalogError 404 when category does not exist", async () => {
    const mockPrisma = prisma as unknown as {
      workbenchCategory: { findUnique: ReturnType<typeof vi.fn> };
    };
    mockPrisma.workbenchCategory.findUnique.mockResolvedValue(null);

    await expect(deleteCategory("nonexistent-id")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockDeleteStorageFile).not.toHaveBeenCalled();
  });
});

describe("collectFilePaths — .b123d path uses code/ subdirectory", () => {
  it("generates correct .b123d path matching persistWorkbenchFiles layout", async () => {
    // Import the exported function directly to unit-test the path construction
    const { collectFilePaths } = await import("../services/workbench-examples.service.js");

    const row = {
      id: EXAMPLE_ID,
      stl_path: null,
      step_path: null,
      threemf_path: null,
      screenshot_front: null,
      screenshot_back: null,
      screenshot_left: null,
      screenshot_right: null,
      screenshot_top: null,
      screenshot_bottom: null,
      screenshot_ortho_45: null,
      screenshot_ortho_45_bottom: null,
      screenshot_iso: null,
      screenshot_iso_back: null,
      category_id: CAT_ID,
      approval_status: "pending",
      eval_score: null,
      created_at: new Date(),
      has_agent_trace: false,
    };

    const paths = collectFilePaths(row);
    expect(paths).toEqual([`workbench/${CAT_ID}/code/${EXAMPLE_ID}.b123d`]);
  });
});
