import * as z from "zod";

/**
 * The dashboard's wire format. `DashboardRun`/`DashboardEvent` in types.ts are the
 * TypeScript view of the same shape; these schemas are what actually validates a payload
 * crossing the HTTP seam between @framelia/dashboard-server and apps/dashboard.
 *
 * Kept structurally independent of those interfaces -- like score.ts's topIssueSchema
 * mirroring @framelia/verify's TopIssue -- rather than derived from them, because the
 * interfaces carry richer optional detail than is worth re-validating on every fetch.
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
 * Validates DashboardContractResult's required top-level shape (see types.ts) and leaves
 * every rich, mostly-optional nested field (baseline/actual/diff/comparison/diagnostics/
 * topIssues/captureEvidence/...) unvalidated via `.loose()` -- the same pragmatic tradeoff
 * score.ts's own evidence schemas make. The required half is what a renderer crashes on.
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
    finishedAt: z.string().optional(),
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
