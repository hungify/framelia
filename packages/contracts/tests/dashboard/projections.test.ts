import { describe, expect, it } from "vitest";

import {
  assembleContractResult,
  deriveCaptureEvidenceDiagnostics,
  deriveComparisonSummary,
  deriveDashboardVerdict,
  projectCapture,
  projectCaptureEvidence,
} from "../../src/dashboard/projections.ts";
import type { DashboardDiagnostic } from "../../src/dashboard/types.ts";

describe("deriveComparisonSummary", () => {
  it("computes diffRatio as 1 - matchRatio", () => {
    const summary = deriveComparisonSummary({
      diffPixels: 10,
      matchRatio: 0.9,
      ssim: 0.95,
      avgDeltaE: 1,
      baselineSize: { width: 100, height: 100 },
      actualSize: { width: 100, height: 100 },
    });
    expect(summary.diffRatio).toBeCloseTo(0.1);
    expect(summary.algorithm).toBe("framelia-multi-signal");
  });

  it("maps null matchRatio to a null diffRatio", () => {
    const summary = deriveComparisonSummary({
      diffPixels: null,
      matchRatio: null,
      ssim: null,
      avgDeltaE: null,
      baselineSize: { width: 100, height: 100 },
      actualSize: { width: 100, height: 100 },
    });
    expect(summary.diffRatio).toBeNull();
    expect(summary.diffPixels).toBeNull();
  });

  it("computes sizeMatch true when baseline and actual sizes are equal", () => {
    const summary = deriveComparisonSummary({
      diffPixels: 0,
      matchRatio: 1,
      ssim: 1,
      avgDeltaE: 0,
      baselineSize: { width: 100, height: 200 },
      actualSize: { width: 100, height: 200 },
    });
    expect(summary.sizeMatch).toBe(true);
  });

  it("computes sizeMatch false when sizes differ", () => {
    const summary = deriveComparisonSummary({
      diffPixels: 0,
      matchRatio: 1,
      ssim: 1,
      avgDeltaE: 0,
      baselineSize: { width: 100, height: 200 },
      actualSize: { width: 100, height: 201 },
    });
    expect(summary.sizeMatch).toBe(false);
  });
});

describe("projectCapture", () => {
  it("projects viewport-scope capture when no region is given", () => {
    const capture = projectCapture({ viewport: { width: 1440, height: 900 } });
    expect(capture).toEqual({ kind: "viewport", viewport: { width: 1440, height: 900 } });
  });

  it("projects element-scope capture with a region, including only present optional fields", () => {
    const capture = projectCapture({
      viewport: { width: 1440, height: 900 },
      region: { selector: ".hero", matchCount: 1, stable: true },
    });
    expect(capture).toEqual({
      kind: "element",
      viewport: { width: 1440, height: 900 },
      target: { definition: { kind: "css", value: ".hero" }, matchCount: 1, stable: true },
    });
  });

  it("includes expectedSize/actualSize/reason only when provided", () => {
    const capture = projectCapture({
      viewport: { width: 1440, height: 900 },
      region: {
        selector: ".hero",
        matchCount: 2,
        stable: false,
        expectedSize: { width: 10, height: 10 },
        actualSize: { width: 12, height: 12 },
        reason: "resized",
      },
    });
    expect(capture).toMatchObject({
      kind: "element",
      target: {
        expectedSize: { width: 10, height: 10 },
        actualSize: { width: 12, height: 12 },
        reason: "resized",
      },
    });
  });
});

const baseCaptureEvidence = {
  finalUrl: "https://example.com/page",
  startedAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:00:01.000Z",
  capturedAt: "2026-09-01T00:00:01.000Z",
  viewport: { width: 1440, height: 900 },
  scope: { kind: "page" as const, fullPage: true },
  elementRect: null,
  readiness: { status: "passed" as const },
  fonts: { supported: true, status: "loaded" as const, failed: [] },
  screenshotHashes: ["sha256:abc"],
  warnings: [],
  actions: [],
};

describe("projectCaptureEvidence", () => {
  it("returns undefined when given no value", () => {
    expect(projectCaptureEvidence(undefined, "https://example.com")).toBeUndefined();
  });

  it("marks redirectMismatch false when finalUrl matches expectedUrl (order/hash-insensitive)", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, finalUrl: "https://example.com/page?b=2&a=1#frag" },
      "https://example.com/page?a=1&b=2",
    );
    expect(projected?.redirectMismatch).toBe(false);
  });

  it("marks redirectMismatch true when finalUrl differs from expectedUrl", () => {
    const projected = projectCaptureEvidence(baseCaptureEvidence, "https://example.com/other-page");
    expect(projected?.redirectMismatch).toBe(true);
  });

  it("falls back to exact string comparison when either URL fails to parse", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, finalUrl: "not a url" },
      "not a url",
    );
    expect(projected?.redirectMismatch).toBe(false);
  });

  it("sets deviceScaleFactor on viewport only when provided", () => {
    const withDsf = projectCaptureEvidence(baseCaptureEvidence, baseCaptureEvidence.finalUrl, 2);
    expect(withDsf?.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 2 });

    const withoutDsf = projectCaptureEvidence(baseCaptureEvidence, baseCaptureEvidence.finalUrl);
    expect(withoutDsf?.viewport).toEqual({ width: 1440, height: 900 });
  });

  it("passes viewport through as null when the source value is null", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, viewport: null },
      baseCaptureEvidence.finalUrl,
    );
    expect(projected?.viewport).toBeNull();
  });

  it("normalizes page-scope fullPage to false when omitted from the source", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, scope: { kind: "page" } },
      baseCaptureEvidence.finalUrl,
    );
    expect(projected?.scope).toEqual({ kind: "page", fullPage: false });
  });

  it("passes region scope through unchanged", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, scope: { kind: "region", selector: ".hero" } },
      baseCaptureEvidence.finalUrl,
    );
    expect(projected?.scope).toEqual({ kind: "region", selector: ".hero" });
  });

  it("defaults maskEvidence to null when absent", () => {
    const projected = projectCaptureEvidence(baseCaptureEvidence, baseCaptureEvidence.finalUrl);
    expect(projected?.maskEvidence).toBeNull();
  });

  it("drops contract-identity/raw-path fields the dashboard doesn't render", () => {
    const projected = projectCaptureEvidence(baseCaptureEvidence, baseCaptureEvidence.finalUrl);
    expect(projected?.artifactPaths).toEqual({});
  });
});

describe("deriveCaptureEvidenceDiagnostics", () => {
  it("returns a single blocking CAPTURE_EVIDENCE_MISSING diagnostic when evidence is absent", () => {
    const diagnostics = deriveCaptureEvidenceDiagnostics(undefined, []);
    expect(diagnostics).toEqual([
      {
        kind: "warning",
        code: "CAPTURE_EVIDENCE_MISSING",
        message:
          "Capture evidence is missing or malformed; visual result cannot be treated as a clean pass.",
        blocking: true,
      },
    ]);
  });

  it("returns no diagnostics for a fully clean capture", () => {
    const projected = projectCaptureEvidence(baseCaptureEvidence, baseCaptureEvidence.finalUrl);
    expect(deriveCaptureEvidenceDiagnostics(projected, [])).toEqual([]);
  });

  it("flags REDIRECT_MISMATCH (blocking) when the final URL differs from expected", () => {
    const projected = projectCaptureEvidence(baseCaptureEvidence, "https://example.com/other");
    const diagnostics = deriveCaptureEvidenceDiagnostics(projected, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "REDIRECT_MISMATCH", blocking: true }),
    );
  });

  it("flags FONT_FALLBACK_OR_LOAD_FAILURE (non-blocking) when fonts didn't load cleanly", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, fonts: { supported: true, status: "loading", failed: ["Inter"] } },
      baseCaptureEvidence.finalUrl,
    );
    const diagnostics = deriveCaptureEvidenceDiagnostics(projected, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "FONT_FALLBACK_OR_LOAD_FAILURE", blocking: false }),
    );
  });

  it("suppresses FONT_FALLBACK_OR_LOAD_FAILURE when the score already reported it", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, fonts: { supported: true, status: "loading", failed: ["Inter"] } },
      baseCaptureEvidence.finalUrl,
    );
    const scoreDiagnostics: DashboardDiagnostic[] = [
      {
        kind: "font-fallback",
        code: "FONT_FALLBACK_OR_LOAD_FAILURE",
        message: "x",
        blocking: false,
      },
    ];
    const diagnostics = deriveCaptureEvidenceDiagnostics(projected, scoreDiagnostics);
    expect(diagnostics.some((d) => d.code === "FONT_FALLBACK_OR_LOAD_FAILURE")).toBe(false);
  });

  it("flags READINESS_FAILED (blocking) when readiness status failed", () => {
    const projected = projectCaptureEvidence(
      { ...baseCaptureEvidence, readiness: { status: "failed" } },
      baseCaptureEvidence.finalUrl,
    );
    const diagnostics = deriveCaptureEvidenceDiagnostics(projected, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "READINESS_FAILED", blocking: true }),
    );
  });

  it("flags NAVIGATION_ACTION_FAILED (blocking) for each failed action", () => {
    const projected = projectCaptureEvidence(
      {
        ...baseCaptureEvidence,
        actions: [
          {
            index: 0,
            kind: "click",
            status: "failed",
            attempts: 2,
            startedAt: "t0",
            finishedAt: "t1",
            error: "not found",
          },
          {
            index: 1,
            kind: "click",
            status: "passed",
            attempts: 1,
            startedAt: "t1",
            finishedAt: "t2",
          },
        ],
      },
      baseCaptureEvidence.finalUrl,
    );
    const diagnostics = deriveCaptureEvidenceDiagnostics(projected, []);
    const navDiagnostics = diagnostics.filter((d) => d.code === "NAVIGATION_ACTION_FAILED");
    expect(navDiagnostics).toHaveLength(1);
    expect(navDiagnostics[0]?.message).toContain("Action 1 (click)");
  });

  it("flags mask evidence not applied, blocking only when failed", () => {
    const skipped = projectCaptureEvidence(
      {
        ...baseCaptureEvidence,
        maskEvidence: {
          requested: [],
          matchedCount: 0,
          bounds: [],
          unionMaskedArea: 0,
          maskedAreaRatio: 0,
          maskColor: "#000",
          status: "skipped",
        },
      },
      baseCaptureEvidence.finalUrl,
    );
    const skippedDiagnostics = deriveCaptureEvidenceDiagnostics(skipped, []);
    expect(skippedDiagnostics).toContainEqual(
      expect.objectContaining({ code: "MASK_EVIDENCE_INCOMPLETE", blocking: false }),
    );

    const failed = projectCaptureEvidence(
      {
        ...baseCaptureEvidence,
        maskEvidence: {
          requested: [],
          matchedCount: 0,
          bounds: [],
          unionMaskedArea: 0,
          maskedAreaRatio: 0,
          maskColor: "#000",
          status: "failed",
          code: "MASK_APPLY_FAILED",
          message: "boom",
        },
      },
      baseCaptureEvidence.finalUrl,
    );
    const failedDiagnostics = deriveCaptureEvidenceDiagnostics(failed, []);
    expect(failedDiagnostics).toContainEqual(
      expect.objectContaining({ code: "MASK_APPLY_FAILED", blocking: true, message: "boom" }),
    );
  });
});

describe("deriveDashboardVerdict", () => {
  it("returns blocked when resultOk is false, regardless of pass", () => {
    expect(
      deriveDashboardVerdict({ resultOk: false, pass: true, diagnostics: [], maskApplied: false }),
    ).toBe("blocked");
  });

  it("returns blocked when any diagnostic is blocking", () => {
    const diagnostics: DashboardDiagnostic[] = [
      { kind: "warning", code: "X", message: "x", blocking: true },
    ];
    expect(
      deriveDashboardVerdict({ resultOk: true, pass: true, diagnostics, maskApplied: false }),
    ).toBe("blocked");
  });

  it("returns failed when ok and no blocking diagnostics but pass is false", () => {
    expect(
      deriveDashboardVerdict({ resultOk: true, pass: false, diagnostics: [], maskApplied: false }),
    ).toBe("failed");
  });

  it("returns passed when ok, passing, no mask applied", () => {
    expect(
      deriveDashboardVerdict({ resultOk: true, pass: true, diagnostics: [], maskApplied: false }),
    ).toBe("passed");
  });

  it("returns masked-pass when ok, passing, and a mask was applied", () => {
    expect(
      deriveDashboardVerdict({ resultOk: true, pass: true, diagnostics: [], maskApplied: true }),
    ).toBe("masked-pass");
  });

  it("non-blocking diagnostics don't prevent a passed/masked-pass verdict", () => {
    const diagnostics: DashboardDiagnostic[] = [
      { kind: "font-fallback", code: "X", message: "x", blocking: false },
    ];
    expect(
      deriveDashboardVerdict({ resultOk: true, pass: true, diagnostics, maskApplied: false }),
    ).toBe("passed");
  });
});

describe("assembleContractResult", () => {
  const minimalInput = {
    id: "home",
    name: "Home",
    tags: [],
    status: "passed" as const,
    baselineKind: "figma" as const,
    capture: { kind: "viewport" as const, viewport: { width: 100, height: 100 } },
    blockers: [],
    diagnostics: [],
    topIssues: [],
    finishedAt: "2026-09-01T00:00:00.000Z",
  };

  it("assembles the minimal required shape, omitting unset optional fields", () => {
    const result = assembleContractResult(minimalInput);
    expect(result).toEqual({
      id: "home",
      name: "Home",
      tags: [],
      status: "passed",
      phase: "complete",
      baselineKind: "figma",
      capture: { kind: "viewport", viewport: { width: 100, height: 100 } },
      blockers: [],
      finishedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(result).not.toHaveProperty("diagnostics");
    expect(result).not.toHaveProperty("topIssues");
    expect(result).not.toHaveProperty("evidenceHash");
  });

  it("always sets phase to complete", () => {
    expect(assembleContractResult(minimalInput).phase).toBe("complete");
  });

  it("includes diagnostics/topIssues only when non-empty", () => {
    const withDiagnostics = assembleContractResult({
      ...minimalInput,
      diagnostics: [{ kind: "warning", code: "X", message: "x", blocking: false }],
      topIssues: [
        {
          severity: "low",
          kind: "pixel",
          message: "x",
          repairCandidate: false,
          blocking: false,
        },
      ],
    });
    expect(withDiagnostics.diagnostics).toHaveLength(1);
    expect(withDiagnostics.topIssues).toHaveLength(1);
  });

  it("includes styleGateEligible when explicitly false (not just when truthy)", () => {
    const result = assembleContractResult({ ...minimalInput, styleGateEligible: false });
    expect(result.styleGateEligible).toBe(false);
  });

  it("includes optional evidence/threshold fields only when provided", () => {
    const result = assembleContractResult({
      ...minimalInput,
      evidenceHash: "sha256:abc",
      resolvedThreshold: {
        name: "page",
        minMatch: 0.9,
        maxDiffPixels: null,
        minSSIM: 0.9,
        maxAvgDeltaE: 1,
        maxAreaGapPercent: 1,
        cluster: false,
        stabilityMaxDiffRatio: 0.1,
      },
    });
    expect(result.evidenceHash).toBe("sha256:abc");
    expect(result.resolvedThreshold?.name).toBe("page");
  });
});
