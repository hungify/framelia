import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION } from "../src/constants.ts";
import {
  checkSchemaVersionSupport,
  dashboardEventSchema,
  dashboardRunSchema,
  MIGRATIONS,
  MIN_SUPPORTED_SCHEMA_VERSION,
  migrateToCurrentSchema,
} from "../src/schema-version.ts";

describe("MIN_SUPPORTED_SCHEMA_VERSION", () => {
  it("equals the current SCHEMA_VERSION (documented hard floor, no earlier version recoverable)", () => {
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe(SCHEMA_VERSION);
  });
});

describe("checkSchemaVersionSupport", () => {
  it("reports supported for the current version", () => {
    expect(checkSchemaVersionSupport(SCHEMA_VERSION)).toEqual({ supported: true });
  });

  it("reports too-old for anything below MIN_SUPPORTED_SCHEMA_VERSION", () => {
    expect(checkSchemaVersionSupport(SCHEMA_VERSION - 1)).toEqual({
      supported: false,
      reason: "too-old",
      found: SCHEMA_VERSION - 1,
    });
  });

  it("reports too-new for anything above the current SCHEMA_VERSION", () => {
    expect(checkSchemaVersionSupport(SCHEMA_VERSION + 1)).toEqual({
      supported: false,
      reason: "too-new",
      found: SCHEMA_VERSION + 1,
    });
  });
});

describe("MIGRATIONS / migrateToCurrentSchema", () => {
  it("MIGRATIONS registry is empty (nothing to migrate from yet)", () => {
    expect(Object.keys(MIGRATIONS)).toHaveLength(0);
  });

  it("is a no-op identity function on a payload already at the current version", () => {
    const raw = { schemaVersion: SCHEMA_VERSION, foo: "bar" };
    expect(migrateToCurrentSchema(raw)).toEqual(raw);
  });

  it("is a no-op identity function on a payload with no numeric schemaVersion", () => {
    const raw = { foo: "bar" };
    expect(migrateToCurrentSchema(raw)).toEqual(raw);
  });

  it("stops without throwing when a payload claims an older version but no migration is registered", () => {
    const raw = { schemaVersion: SCHEMA_VERSION - 1, foo: "bar" };
    expect(migrateToCurrentSchema(raw)).toEqual(raw);
  });
});

describe("dashboardEventSchema (additive, currently-inert)", () => {
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

describe("dashboardRunSchema (additive, currently-inert)", () => {
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
