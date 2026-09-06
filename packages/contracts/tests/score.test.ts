import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION } from "../src/constants.ts";
import {
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  stabilitySchema,
  topIssueSchema,
  visualDiagnosticSchema,
  visualScoreArtifactSchema,
} from "../src/score.ts";

const validHash = `sha256:${"a".repeat(64)}`;

const validCaptureEvidence = {
  finalUrl: "https://example.com",
  startedAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:00:01.000Z",
  capturedAt: "2026-09-01T00:00:01.000Z",
  viewport: { width: 1440, height: 900 },
  scope: { kind: "page" as const, fullPage: true },
  elementRect: null,
  readiness: { status: "passed" as const },
  fonts: { supported: true, status: "loaded" as const, failed: [] },
  screenshotHashes: [validHash],
  warnings: [],
  actions: [],
};

const validScore = {
  schemaVersion: SCHEMA_VERSION,
  ok: true as const,
  pass: true,
  matchRatio: 1,
  ssim: 1,
  avgDeltaE: 0,
  diffPixels: 0,
  baselineSize: { width: 100, height: 100 },
  actualSize: { width: 100, height: 100 },
  baseline: { kind: "figma" as const, path: "/tmp/baseline.png" },
  target: { url: "https://example.com" },
  selector: null,
  stability: "stable" as const,
  evidenceHashes: { baseline: validHash, actual: validHash, diff: null },
  artifacts: { baseline: "/tmp/baseline.png", actual: "/tmp/actual.png", diff: null },
};

describe("stabilitySchema", () => {
  it("accepts every documented stability value", () => {
    for (const value of ["stable", "borderline", "unknown"]) {
      expect(stabilitySchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an unknown value", () => {
    expect(stabilitySchema.safeParse("flaky").success).toBe(false);
  });
});

describe("captureMaskEvidenceSchema", () => {
  const validMaskEvidence = {
    requested: [],
    matchedCount: 0,
    bounds: [],
    unionMaskedArea: 0,
    maskedAreaRatio: 0,
    maskColor: "#000",
    status: "applied" as const,
  };

  it("round-trips a minimal valid mask evidence object", () => {
    expect(captureMaskEvidenceSchema.safeParse(validMaskEvidence).success).toBe(true);
  });

  it("accepts every documented status value", () => {
    for (const status of ["applied", "skipped", "failed"]) {
      expect(captureMaskEvidenceSchema.safeParse({ ...validMaskEvidence, status }).success).toBe(
        true,
      );
    }
  });

  it("rejects an unknown status value", () => {
    expect(
      captureMaskEvidenceSchema.safeParse({ ...validMaskEvidence, status: "unknown" }).success,
    ).toBe(false);
  });

  it("is loose: allows an unrecognized extra field", () => {
    expect(
      captureMaskEvidenceSchema.safeParse({ ...validMaskEvidence, futureField: 1 }).success,
    ).toBe(true);
  });
});

describe("visualDiagnosticSchema", () => {
  const valid = {
    kind: "warning" as const,
    code: "SOME_CODE",
    message: "something happened",
    blocking: true,
  };

  it("round-trips a valid diagnostic", () => {
    expect(visualDiagnosticSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts every documented kind value", () => {
    for (const kind of ["skipped", "unmatched-region", "font-fallback", "warning", "masked-pass"]) {
      expect(visualDiagnosticSchema.safeParse({ ...valid, kind }).success).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(visualDiagnosticSchema.safeParse({ ...valid, kind: "other" }).success).toBe(false);
  });

  it("rejects an empty message (strict, min 1)", () => {
    expect(visualDiagnosticSchema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });

  it("rejects an unknown field (strict)", () => {
    expect(visualDiagnosticSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe("topIssueSchema", () => {
  const valid = {
    severity: "high" as const,
    kind: "pixel" as const,
    message: "pixels differ",
    repairCandidate: false,
    blocking: true,
  };

  it("round-trips a valid top issue", () => {
    expect(topIssueSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts every documented kind value", () => {
    const kinds = [
      "size",
      "expect-size",
      "pixel",
      "ssim",
      "color",
      "cluster",
      "style-typography",
      "style-color",
      "style-check-error",
      "baseline-stability",
      "capture-stability",
      "residual",
      "pixel-attribution",
    ];
    for (const kind of kinds) {
      expect(topIssueSchema.safeParse({ ...valid, kind }).success).toBe(true);
    }
  });

  it("rejects an unknown severity", () => {
    expect(topIssueSchema.safeParse({ ...valid, severity: "critical" }).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(topIssueSchema.safeParse({ ...valid, kind: "other" }).success).toBe(false);
  });

  it("round-trips with the optional selector/hint set", () => {
    const full = { ...valid, hint: "try this", selector: ".title" };
    const result = topIssueSchema.safeParse(full);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(full);
  });
});

describe("captureEvidenceSchema", () => {
  it("round-trips a minimal valid capture evidence object", () => {
    expect(captureEvidenceSchema.safeParse(validCaptureEvidence).success).toBe(true);
  });

  it("is loose: allows an unrecognized top-level field", () => {
    expect(
      captureEvidenceSchema.safeParse({ ...validCaptureEvidence, futureField: 1 }).success,
    ).toBe(true);
  });

  describe(".catch() degradation: maskEvidence", () => {
    it("keeps a well-formed maskEvidence value", () => {
      const withMask = {
        ...validCaptureEvidence,
        maskEvidence: {
          requested: [],
          matchedCount: 0,
          bounds: [],
          unionMaskedArea: 0,
          maskedAreaRatio: 0,
          maskColor: "#000",
          status: "applied" as const,
        },
      };
      const result = captureEvidenceSchema.safeParse(withMask);
      expect(result.success).toBe(true);
      expect(result.success && result.data.maskEvidence?.status).toBe("applied");
    });

    it("degrades a malformed maskEvidence to null instead of failing the whole document", () => {
      const withBadMask = { ...validCaptureEvidence, maskEvidence: { status: "not-a-status" } };
      const result = captureEvidenceSchema.safeParse(withBadMask);
      expect(result.success).toBe(true);
      expect(result.success && result.data.maskEvidence).toBeNull();
    });

    it("accepts an explicit null maskEvidence", () => {
      const result = captureEvidenceSchema.safeParse({
        ...validCaptureEvidence,
        maskEvidence: null,
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.maskEvidence).toBeNull();
    });
  });
});

describe("visualScoreArtifactSchema", () => {
  it("round-trips a minimal valid score", () => {
    const result = visualScoreArtifactSchema.safeParse(validScore);
    expect(result.success).toBe(true);
    expect(result.success && result.data.pass).toBe(true);
    expect(result.success && result.data.stability).toBe("stable");
  });

  it("is loose: allows an unrecognized top-level field", () => {
    expect(visualScoreArtifactSchema.safeParse({ ...validScore, futureField: 1 }).success).toBe(
      true,
    );
  });

  it("rejects ok: false (ok is pinned z.literal(true))", () => {
    expect(visualScoreArtifactSchema.safeParse({ ...validScore, ok: false }).success).toBe(false);
  });

  it("rejects a schemaVersion other than the current SCHEMA_VERSION", () => {
    expect(
      visualScoreArtifactSchema.safeParse({ ...validScore, schemaVersion: SCHEMA_VERSION - 1 })
        .success,
    ).toBe(false);
  });

  it("allows matchRatio/ssim/avgDeltaE/diffPixels to be explicitly null (unscoreable comparison)", () => {
    const nulled = {
      ...validScore,
      matchRatio: null,
      ssim: null,
      avgDeltaE: null,
      diffPixels: null,
    };
    expect(visualScoreArtifactSchema.safeParse(nulled).success).toBe(true);
  });

  describe(".catch() degradation: captureEvidence", () => {
    it("keeps a well-formed captureEvidence value", () => {
      const withCapture = { ...validScore, captureEvidence: validCaptureEvidence };
      const result = visualScoreArtifactSchema.safeParse(withCapture);
      expect(result.success).toBe(true);
      expect(result.success && result.data.captureEvidence?.finalUrl).toBe("https://example.com");
    });

    it("degrades a malformed captureEvidence to undefined instead of failing the whole score", () => {
      const withBadCapture = { ...validScore, captureEvidence: { finalUrl: 123 } };
      const result = visualScoreArtifactSchema.safeParse(withBadCapture);
      expect(result.success).toBe(true);
      expect(result.success && result.data.captureEvidence).toBeUndefined();
    });
  });

  describe(".catch() degradation: baselineCaptureEvidence", () => {
    it("keeps a well-formed baselineCaptureEvidence value", () => {
      const withBaseline = { ...validScore, baselineCaptureEvidence: validCaptureEvidence };
      const result = visualScoreArtifactSchema.safeParse(withBaseline);
      expect(result.success).toBe(true);
      expect(result.success && result.data.baselineCaptureEvidence?.finalUrl).toBe(
        "https://example.com",
      );
    });

    it("degrades a malformed baselineCaptureEvidence to undefined", () => {
      const withBadBaseline = { ...validScore, baselineCaptureEvidence: { finalUrl: 123 } };
      const result = visualScoreArtifactSchema.safeParse(withBadBaseline);
      expect(result.success).toBe(true);
      expect(result.success && result.data.baselineCaptureEvidence).toBeUndefined();
    });
  });

  describe(".catch() degradation: profile", () => {
    it("keeps a well-formed profile value", () => {
      const withProfile = { ...validScore, profile: "component/strict" as const };
      const result = visualScoreArtifactSchema.safeParse(withProfile);
      expect(result.success).toBe(true);
      expect(result.success && result.data.profile).toBe("component/strict");
    });

    it("degrades an unknown profile value to undefined instead of failing the whole score", () => {
      const withBadProfile = { ...validScore, profile: "not-a-profile" };
      const result = visualScoreArtifactSchema.safeParse(withBadProfile);
      expect(result.success).toBe(true);
      expect(result.success && result.data.profile).toBeUndefined();
    });
  });

  describe(".catch() degradation: clusterCheck", () => {
    it("keeps a well-formed clusterCheck value", () => {
      const result = visualScoreArtifactSchema.safeParse({ ...validScore, clusterCheck: true });
      expect(result.success).toBe(true);
      expect(result.success && result.data.clusterCheck).toBe(true);
    });

    it("degrades a malformed clusterCheck value to undefined", () => {
      const result = visualScoreArtifactSchema.safeParse({ ...validScore, clusterCheck: "yes" });
      expect(result.success).toBe(true);
      expect(result.success && result.data.clusterCheck).toBeUndefined();
    });
  });

  describe(".catch() degradation: styleGateEligible", () => {
    it("keeps a well-formed styleGateEligible value", () => {
      const result = visualScoreArtifactSchema.safeParse({
        ...validScore,
        styleGateEligible: true,
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.styleGateEligible).toBe(true);
    });

    it("degrades a malformed styleGateEligible value to undefined", () => {
      const result = visualScoreArtifactSchema.safeParse({
        ...validScore,
        styleGateEligible: "yes",
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.styleGateEligible).toBeUndefined();
    });
  });
});
