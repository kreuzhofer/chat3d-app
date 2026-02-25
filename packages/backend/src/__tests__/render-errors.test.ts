import { describe, expect, it } from "vitest";
import {
  classifyRenderError,
  buildEscalatedGuidance,
  renderWithInfraRetry,
  consecutiveSameCategoryCount,
  RenderErrorCategory,
  type ClassifiedRenderError,
} from "../utils/render-errors.js";
import { RenderingServiceError } from "../services/rendering.service.js";

// ── classifyRenderError ───────────────────────────────────────────────────────

describe("classifyRenderError", () => {
  describe("infrastructure errors", () => {
    it("classifies 'service unreachable' as INFRASTRUCTURE", () => {
      const result = classifyRenderError(new Error("Build123d service unreachable: fetch failed"));
      expect(result.category).toBe(RenderErrorCategory.INFRASTRUCTURE);
      expect(result.isInfrastructure).toBe(true);
      expect(result.fixGuidance).toBeNull();
    });

    it("classifies timeout as INFRASTRUCTURE", () => {
      const result = classifyRenderError(new Error("Build123d service timeout after 120s"));
      expect(result.category).toBe(RenderErrorCategory.INFRASTRUCTURE);
      expect(result.isInfrastructure).toBe(true);
    });

    it("classifies ECONNREFUSED as INFRASTRUCTURE", () => {
      const result = classifyRenderError(new Error("connect ECONNREFUSED 127.0.0.1:80"));
      expect(result.category).toBe(RenderErrorCategory.INFRASTRUCTURE);
      expect(result.isInfrastructure).toBe(true);
    });

    it("uses RenderingServiceError.isInfrastructure as fast-path", () => {
      const err = new RenderingServiceError("Build123d service unreachable: fetch failed", 502, true);
      const result = classifyRenderError(err);
      expect(result.category).toBe(RenderErrorCategory.INFRASTRUCTURE);
      expect(result.isInfrastructure).toBe(true);
    });
  });

  describe("API misuse errors", () => {
    it("classifies NameError with captured function name", () => {
      const result = classifyRenderError(
        new Error("NameError: name 'Polyline' is not defined"),
      );
      expect(result.category).toBe(RenderErrorCategory.API_MISUSE);
      expect(result.capturedDetail).toBe("Polyline");
      expect(result.fixGuidance).toContain("Polyline");
      expect(result.isInfrastructure).toBe(false);
    });

    it("classifies AttributeError with captured attribute name", () => {
      const result = classifyRenderError(
        new Error("AttributeError: 'Part' object has no attribute 'fuse'"),
      );
      expect(result.category).toBe(RenderErrorCategory.API_MISUSE);
      expect(result.capturedDetail).toBe("fuse");
      expect(result.fixGuidance).toContain("fuse");
    });

    it("classifies ImportError", () => {
      const result = classifyRenderError(
        new Error("ImportError: No module named 'cadquery'"),
      );
      expect(result.category).toBe(RenderErrorCategory.API_MISUSE);
      expect(result.fixGuidance).toContain("build123d");
    });

    it("classifies ModuleNotFoundError", () => {
      const result = classifyRenderError(
        new Error("ModuleNotFoundError: No module named 'trimesh'"),
      );
      expect(result.category).toBe(RenderErrorCategory.API_MISUSE);
    });
  });

  describe("geometry errors", () => {
    it("classifies 'No objects to create a hull'", () => {
      const result = classifyRenderError(
        new Error("Execution error: No objects to create a hull\nTraceback..."),
      );
      expect(result.category).toBe(RenderErrorCategory.GEOMETRY);
      expect(result.fixGuidance).toContain("sketch");
      expect(result.fixGuidance).toContain("BuildSketch");
    });

    it("classifies ValueError with 'degenerate'", () => {
      const result = classifyRenderError(
        new Error("ValueError: degenerate edge detected"),
      );
      expect(result.category).toBe(RenderErrorCategory.GEOMETRY);
      expect(result.fixGuidance).toContain("degenerate");
    });

    it("classifies generic ValueError", () => {
      const result = classifyRenderError(
        new Error("ValueError: fillet radius too large for edge"),
      );
      expect(result.category).toBe(RenderErrorCategory.GEOMETRY);
      expect(result.fixGuidance).toContain("positive dimensions");
    });
  });

  describe("kernel errors", () => {
    it("classifies BRep_API not done", () => {
      const result = classifyRenderError(
        new Error(
          "OCP.OCP.StdFail.StdFail_NotDone: BRep_API: command not done\n" +
            "  File \"<string>\", line 43, in <module>",
        ),
      );
      expect(result.category).toBe(RenderErrorCategory.KERNEL_ERROR);
      expect(result.fixGuidance).toContain("zero-length edges");
    });

    it("classifies StdFail_NotDone standalone", () => {
      const result = classifyRenderError(
        new Error("StdFail_NotDone: some CAD operation failed"),
      );
      expect(result.category).toBe(RenderErrorCategory.KERNEL_ERROR);
    });

    it("classifies Standard_NullObject", () => {
      const result = classifyRenderError(
        new Error("Standard_NullObject: TopoDS null shape encountered"),
      );
      expect(result.category).toBe(RenderErrorCategory.KERNEL_ERROR);
      expect(result.fixGuidance).toContain("simpler");
    });
  });

  describe("type errors", () => {
    it("classifies TypeError with 'argument'", () => {
      const result = classifyRenderError(
        new Error("TypeError: Box() takes 3 positional arguments but 4 were given"),
      );
      expect(result.category).toBe(RenderErrorCategory.TYPE_ERROR);
      expect(result.fixGuidance).toContain("argument type");
    });

    it("classifies TypeError with 'expected'", () => {
      const result = classifyRenderError(
        new Error("TypeError: expected float, got str"),
      );
      expect(result.category).toBe(RenderErrorCategory.TYPE_ERROR);
    });

    it("classifies generic TypeError", () => {
      const result = classifyRenderError(
        new Error("TypeError: unsupported operand type(s) for +: 'Part' and 'int'"),
      );
      expect(result.category).toBe(RenderErrorCategory.TYPE_ERROR);
    });
  });

  describe("unknown errors", () => {
    it("classifies unrecognized errors as UNKNOWN", () => {
      const result = classifyRenderError(new Error("Something completely unexpected happened"));
      expect(result.category).toBe(RenderErrorCategory.UNKNOWN);
      expect(result.isInfrastructure).toBe(false);
      expect(result.fixGuidance).toBeNull();
    });

    it("preserves the raw message", () => {
      const msg = "Exotic Python error: foobar";
      const result = classifyRenderError(new Error(msg));
      expect(result.rawMessage).toBe(msg);
    });

    it("handles string input", () => {
      const result = classifyRenderError("raw error string");
      expect(result.rawMessage).toBe("raw error string");
      expect(result.category).toBe(RenderErrorCategory.UNKNOWN);
    });
  });
});

// ── consecutiveSameCategoryCount ──────────────────────────────────────────────

describe("consecutiveSameCategoryCount", () => {
  const makeError = (category: RenderErrorCategory): ClassifiedRenderError => ({
    rawMessage: "test",
    category,
    isInfrastructure: false,
    fixGuidance: "test guidance",
    capturedDetail: null,
  });

  it("returns 0 for empty history", () => {
    expect(consecutiveSameCategoryCount([], RenderErrorCategory.GEOMETRY)).toBe(0);
  });

  it("returns 1 when last error matches", () => {
    const history = [makeError(RenderErrorCategory.GEOMETRY)];
    expect(consecutiveSameCategoryCount(history, RenderErrorCategory.GEOMETRY)).toBe(1);
  });

  it("returns 0 when last error differs", () => {
    const history = [makeError(RenderErrorCategory.API_MISUSE)];
    expect(consecutiveSameCategoryCount(history, RenderErrorCategory.GEOMETRY)).toBe(0);
  });

  it("counts consecutive tail matches only", () => {
    const history = [
      makeError(RenderErrorCategory.API_MISUSE),
      makeError(RenderErrorCategory.GEOMETRY),
      makeError(RenderErrorCategory.GEOMETRY),
      makeError(RenderErrorCategory.GEOMETRY),
    ];
    expect(consecutiveSameCategoryCount(history, RenderErrorCategory.GEOMETRY)).toBe(3);
  });

  it("stops counting at first different category", () => {
    const history = [
      makeError(RenderErrorCategory.GEOMETRY),
      makeError(RenderErrorCategory.API_MISUSE),
      makeError(RenderErrorCategory.GEOMETRY),
    ];
    expect(consecutiveSameCategoryCount(history, RenderErrorCategory.GEOMETRY)).toBe(1);
  });
});

// ── buildEscalatedGuidance ────────────────────────────────────────────────────

describe("buildEscalatedGuidance", () => {
  const makeClassified = (
    category: RenderErrorCategory,
    guidance: string | null = "Standard fix guidance",
  ): ClassifiedRenderError => ({
    rawMessage: "test error",
    category,
    isInfrastructure: category === RenderErrorCategory.INFRASTRUCTURE,
    fixGuidance: guidance,
    capturedDetail: null,
  });

  it("returns null for infrastructure errors", () => {
    const current = makeClassified(RenderErrorCategory.INFRASTRUCTURE, null);
    expect(buildEscalatedGuidance(current, [])).toBeNull();
  });

  it("returns standard guidance on first occurrence", () => {
    const current = makeClassified(RenderErrorCategory.GEOMETRY);
    const result = buildEscalatedGuidance(current, []);
    expect(result).toBe("Standard fix guidance");
  });

  it("returns raw message when fixGuidance is null (UNKNOWN)", () => {
    const current = makeClassified(RenderErrorCategory.UNKNOWN, null);
    const result = buildEscalatedGuidance(current, []);
    expect(result).toBe("test error");
  });

  it("adds IMPORTANT prefix on second consecutive same-category error", () => {
    const current = makeClassified(RenderErrorCategory.GEOMETRY);
    const history = [makeClassified(RenderErrorCategory.GEOMETRY)];
    const result = buildEscalatedGuidance(current, history);
    expect(result).toContain("IMPORTANT:");
    expect(result).toContain("fundamentally different approach");
    expect(result).toContain("Standard fix guidance");
  });

  it("adds CRITICAL prefix on third consecutive same-category error", () => {
    const current = makeClassified(RenderErrorCategory.KERNEL_ERROR);
    const history = [
      makeClassified(RenderErrorCategory.KERNEL_ERROR),
      makeClassified(RenderErrorCategory.KERNEL_ERROR),
    ];
    const result = buildEscalatedGuidance(current, history);
    expect(result).toContain("CRITICAL:");
    expect(result).toContain("3 consecutive attempts");
    expect(result).toContain("basic primitives");
  });

  it("does not escalate when previous error was a different category", () => {
    const current = makeClassified(RenderErrorCategory.GEOMETRY);
    const history = [makeClassified(RenderErrorCategory.API_MISUSE)];
    const result = buildEscalatedGuidance(current, history);
    expect(result).toBe("Standard fix guidance");
    expect(result).not.toContain("IMPORTANT");
  });
});

// ── renderWithInfraRetry ──────────────────────────────────────────────────────

describe("renderWithInfraRetry", () => {
  it("returns ok result on success", async () => {
    const result = await renderWithInfraRetry(
      async () => ({ files: [{ filename: "test.stl", contentBase64: "" }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.files).toHaveLength(1);
    }
  });

  it("returns classified error for code errors without retry", async () => {
    let callCount = 0;
    const result = await renderWithInfraRetry(
      async () => {
        callCount++;
        throw new Error("ValueError: No objects to create a hull");
      },
      { maxRetries: 2, delayMs: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe(RenderErrorCategory.GEOMETRY);
    }
    expect(callCount).toBe(1); // No retries for code errors
  });

  it("retries infrastructure errors up to maxRetries", async () => {
    let callCount = 0;
    const result = await renderWithInfraRetry(
      async () => {
        callCount++;
        throw new RenderingServiceError("Build123d service unreachable: fetch failed", 502, true);
      },
      { maxRetries: 2, delayMs: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe(RenderErrorCategory.INFRASTRUCTURE);
    }
    expect(callCount).toBe(3); // 1 initial + 2 retries
  });

  it("succeeds after infrastructure retry recovers", async () => {
    let callCount = 0;
    const result = await renderWithInfraRetry(
      async () => {
        callCount++;
        if (callCount <= 1) {
          throw new RenderingServiceError("Build123d service unreachable: fetch failed", 502, true);
        }
        return { files: [{ filename: "test.stl", contentBase64: "" }] };
      },
      { maxRetries: 2, delayMs: 0 },
    );
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2); // 1 fail + 1 success
  });

  it("calls onRetry callback for infrastructure retries", async () => {
    const retryAttempts: number[] = [];
    await renderWithInfraRetry(
      async () => {
        throw new RenderingServiceError("Build123d service unreachable: fetch failed", 502, true);
      },
      {
        maxRetries: 2,
        delayMs: 0,
        onRetry: (attempt) => retryAttempts.push(attempt),
      },
    );
    expect(retryAttempts).toEqual([1, 2]);
  });
});
