import { describe, expect, it } from "vitest";

import { assembleContractResult } from "../../src/dashboard/projections.ts";
import { dashboardEventSchema, dashboardRunSchema } from "../../src/dashboard/wire.ts";

describe("dashboardEventSchema", () => {
  const validEvent = {
    sequence: 0,
    runId: "run-1",
    status: "passed" as const,
    timestamp: "2026-09-01T00:00:00.000Z",
  };

  it("round-trips a minimal valid event", () => {
    const result = dashboardEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(validEvent);
  });

  it("round-trips an event with every optional field set", () => {
    const full = { ...validEvent, contractId: "home", phase: "capture" as const };
    const result = dashboardEventSchema.safeParse(full);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(full);
  });

  it("rejects an unknown status value", () => {
    expect(dashboardEventSchema.safeParse({ ...validEvent, status: "unknown" }).success).toBe(
      false,
    );
  });

  it("rejects a negative sequence", () => {
    expect(dashboardEventSchema.safeParse({ ...validEvent, sequence: -1 }).success).toBe(false);
  });

  it("rejects a malformed timestamp", () => {
    expect(dashboardEventSchema.safeParse({ ...validEvent, timestamp: "not-a-date" }).success).toBe(
      false,
    );
  });
});

describe("dashboardRunSchema", () => {
  const validRun = {
    schemaVersion: 1 as const,
    runId: "run-1",
    status: "passed" as const,
    summary: { queued: 0, running: 0, passed: 1, failed: 0, blocked: 0, total: 1 },
    contracts: [
      {
        id: "home",
        name: "Home",
        tags: [],
        status: "passed" as const,
        phase: "complete" as const,
        baselineKind: "figma" as const,
        capture: { kind: "viewport" as const },
        blockers: [],
        finishedAt: "2026-09-01T00:00:01.000Z",
      },
    ],
    startedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:01.000Z",
  };

  it("round-trips a minimal valid run", () => {
    expect(dashboardRunSchema.safeParse(validRun).success).toBe(true);
  });

  it("accepts queued contracts before a finish timestamp exists", () => {
    const queued = {
      ...validRun,
      status: "running",
      summary: { queued: 1, running: 0, passed: 0, failed: 0, blocked: 0, total: 1 },
      contracts: [
        { ...validRun.contracts[0], status: "queued", phase: "queued", finishedAt: undefined },
      ],
    };
    expect(dashboardRunSchema.parse(queued).contracts[0]?.status).toBe("queued");
  });

  it("allows a contract with unrecognized extra fields (loose)", () => {
    const withExtra = {
      ...validRun,
      contracts: [{ ...validRun.contracts[0], someFutureField: 42 }],
    };
    expect(dashboardRunSchema.safeParse(withExtra).success).toBe(true);
  });

  it("rejects a run with a wrong schemaVersion literal", () => {
    expect(dashboardRunSchema.safeParse({ ...validRun, schemaVersion: 2 }).success).toBe(false);
  });

  it("rejects a contract missing a required field (id)", () => {
    const invalid = {
      ...validRun,
      contracts: [{ ...validRun.contracts[0], id: undefined }],
    };
    expect(dashboardRunSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown top-level field (strict)", () => {
    expect(dashboardRunSchema.safeParse({ ...validRun, extra: 1 }).success).toBe(false);
  });
});

describe("wire format vs. the projection that produces it", () => {
  /**
   * The schema only earns its place at the HTTP seam if what `assembleContractResult`
   * emits actually parses. This is the test that fails if the two drift.
   */
  it("accepts a run whose contract came out of assembleContractResult", () => {
    const contract = assembleContractResult({
      id: "home.desktop",
      name: "Home / desktop",
      tags: ["desktop", "page"],
      status: "passed",
      baselineKind: "figma",
      capture: { kind: "viewport", viewport: { width: 1280, height: 720 } },
      blockers: [],
      diagnostics: [],
      topIssues: [],
      score: {
        diffPixels: 0,
        matchRatio: 1,
        ssim: 1,
        avgDeltaE: 0,
        baselineSize: { width: 1280, height: 720 },
        actualSize: { width: 1280, height: 720 },
        profile: "page",
      },
      finishedAt: "2026-09-01T00:00:01.000Z",
    });

    const parsed = dashboardRunSchema.safeParse({
      schemaVersion: 1,
      runId: "run-1",
      status: "passed",
      summary: { queued: 0, running: 0, passed: 1, failed: 0, blocked: 0, total: 1 },
      contracts: [contract],
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    });

    expect(parsed.success).toBe(true);
  });
});
