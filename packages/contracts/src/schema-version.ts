import * as z from "zod";

import { SCHEMA_VERSION } from "./constants.ts";

/**
 * Oldest schema version this package can still make sense of. Set to the
 * current {@link SCHEMA_VERSION} (5) as a documented hard floor: versions 1-4
 * predate this repository's git history (confirmed via `git log`), so there
 * is no real shape data anywhere to build a migration from. If a future
 * schema bump needs a genuine migration path, this constant -- and the
 * {@link MIGRATIONS} registry below -- is where it starts.
 */
export const MIN_SUPPORTED_SCHEMA_VERSION = SCHEMA_VERSION;

export type SchemaVersionSupport =
  | { supported: true }
  | { supported: false; reason: "too-old" | "too-new"; found: number };

/**
 * Classifies a `schemaVersion` value read off disk (or over the wire) before
 * attempting to parse the rest of the payload -- lets a caller give a useful
 * "this file is from an old/future framelia version" message instead of a
 * generic Zod validation failure when the version itself is out of range.
 */
export function checkSchemaVersionSupport(schemaVersion: number): SchemaVersionSupport {
  if (schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return { supported: false, reason: "too-old", found: schemaVersion };
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return { supported: false, reason: "too-new", found: schemaVersion };
  }
  return { supported: true };
}

/**
 * One migration step: transforms a raw (already JSON-parsed, not yet
 * schema-validated) payload from `from` to `from + 1`. Registered under the
 * source version it migrates away from.
 */
export type SchemaMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of migrations, keyed by the schema version a payload currently
 * carries. Empty today -- SCHEMA_VERSION has never been bumped within this
 * repository's history, so there is nothing yet to migrate from. Purely
 * additive scaffolding for the next version bump; {@link migrateToCurrentSchema}
 * is a no-op identity function until an entry is added here.
 */
export const MIGRATIONS: Record<number, SchemaMigration> = {};

/**
 * Repeatedly applies {@link MIGRATIONS} steps to `raw` until its
 * `schemaVersion` field reaches the current {@link SCHEMA_VERSION}, or no
 * further migration is registered. Does not itself validate the result --
 * callers still run the migrated payload through the appropriate Zod schema.
 */
export function migrateToCurrentSchema(raw: Record<string, unknown>): Record<string, unknown> {
  let current = raw;
  while (typeof current.schemaVersion === "number" && current.schemaVersion < SCHEMA_VERSION) {
    const migration = MIGRATIONS[current.schemaVersion];
    if (!migration) break;
    current = migration(current);
  }
  return current;
}

/**
 * Additive, currently-inert schemas for the dashboard's own UI-projection
 * format (`DashboardRun`/`DashboardEvent` in dashboard/types.ts today are
 * bare TS interfaces, never parsed). Kept structurally independent of those
 * interfaces -- like score.ts's topIssueSchema mirroring @framelia/verify's
 * TopIssue -- rather than imported, since dashboard/types.ts isn't wired to
 * validate through these yet; @framelia/dashboard-server opting in is future
 * work, out of scope for this rewrite.
 */
const dashboardVerdictSchema = z.enum([
  "queued",
  "running",
  "passed",
  "masked-pass",
  "failed",
  "blocked",
]);

const dashboardPhaseSchema = z.enum([
  "queued",
  "baseline",
  "capture",
  "compare",
  "gates",
  "complete",
]);

export const dashboardEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    runId: z.string().min(1),
    contractId: z.string().min(1).optional(),
    phase: dashboardPhaseSchema.optional(),
    status: dashboardVerdictSchema,
    timestamp: z.iso.datetime(),
  })
  .strict();

const dashboardSummarySchema = z
  .object({
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    "masked-pass": z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Validates DashboardContractResult's required top-level shape (see
 * dashboard/types.ts) and leaves every rich, mostly-optional nested field
 * (baseline/actual/diff/comparison/diagnostics/topIssues/captureEvidence/...)
 * unvalidated via `.loose()`, the same pragmatic tradeoff score.ts's own
 * evidence schemas already make -- full-fidelity validation of that shape
 * duplicates dashboard/types.ts's interface for no consumer that exists yet.
 */
const dashboardContractResultSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    tags: z.array(z.string()),
    status: dashboardVerdictSchema,
    phase: dashboardPhaseSchema,
    baselineKind: z.enum(["figma", "page"]),
    capture: z.object({ kind: z.enum(["viewport", "element"]) }).loose(),
    blockers: z.array(z.object({ code: z.string(), message: z.string() }).loose()),
    finishedAt: z.string(),
  })
  .loose();

export const dashboardRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    suiteName: z.string().min(1).optional(),
    status: dashboardVerdictSchema,
    summary: dashboardSummarySchema,
    contracts: z.array(dashboardContractResultSchema),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
  })
  .strict();

export type DashboardEventShape = z.infer<typeof dashboardEventSchema>;
export type DashboardRunShape = z.infer<typeof dashboardRunSchema>;
