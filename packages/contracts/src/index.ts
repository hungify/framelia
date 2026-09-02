/**
 * Curated public barrel. Every export here is a named re-export, not `export *`
 * -- this file *is* the package's public-surface enforcement mechanism (see
 * tests/public-api.test.ts, which snapshots the export-name set below). An
 * internal module is free to export more than what's listed here; only names
 * actually re-exported from this file are part of @framelia/contracts's
 * public API and require a changeset to change.
 */

export { type VerificationArtifact, verificationArtifactSchema } from "./artifact.ts";

export {
  type BaselineSource,
  baselineSchema,
  type FigmaBaselineSource,
  figmaBaselineSchema,
} from "./baseline.ts";

export { type CaptureDefaults, captureDefaultsSchema } from "./capture-defaults.ts";

export {
  CONTRACT_ID_PATTERN,
  DEFAULT_MAX_MASKED_AREA_RATIO,
  FIGMA_NODE_ID,
  MAX_CONTRACT_TIMEOUT_MS,
  MAX_CONTRACTS_PER_REQUEST,
  MAX_MASK_SELECTORS,
  MIN_CONTRACT_TIMEOUT_MS,
  MIN_CONTRACTS_PER_REQUEST,
  MIN_STABILITY_SAMPLES,
  MAX_STABILITY_SAMPLES,
  SCHEMA_VERSION,
} from "./constants.ts";

export {
  assembleContractResult,
  deriveCaptureEvidenceDiagnostics,
  deriveComparisonSummary,
  deriveDashboardVerdict,
  projectCapture,
  projectCaptureEvidence,
} from "./dashboard/projections.ts";
export type {
  DashboardCaptureEvidence,
  DashboardContractResult,
  DashboardDiagnostic,
  DashboardEvent,
  DashboardImageEvidence,
  DashboardMaskEvidence,
  DashboardResolvedThreshold,
  DashboardRun,
  DashboardSummary,
  DashboardTopIssue,
  DashboardVerdict,
  ProjectCaptureRegion,
} from "./dashboard/types.ts";

export { toJsonSchema } from "./json-schema.ts";

export {
  DEFAULT_AUTH_STATE_PATH,
  DEFAULT_DISCOVERY_DIR,
  DISCOVERY_DIR_NAME,
  FRAMELIA_DIR,
  VISUAL_ARTIFACT_DIR_PATTERN,
  VISUAL_CONTRACT_FILE,
  VISUAL_VERIFICATION_FILE,
  VISUAL_VERIFICATIONS_DIR,
  VISUAL_VERIFICATIONS_ROOT,
  visualArtifactPath,
} from "./paths.ts";

export { httpUrlSchema, nonEmptyTrimmed } from "./primitives.ts";

export { type VerificationRequest, verificationRequestSchema } from "./request.ts";

export {
  checkSchemaVersionSupport,
  dashboardEventSchema,
  type DashboardEventShape,
  dashboardRunSchema,
  type DashboardRunShape,
  MIGRATIONS,
  MIN_SUPPORTED_SCHEMA_VERSION,
  migrateToCurrentSchema,
  type SchemaMigration,
  type SchemaVersionSupport,
} from "./schema-version.ts";

export {
  type CaptureEvidenceArtifact,
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  type Stability,
  stabilitySchema,
  topIssueSchema,
  type VisualDiagnostic,
  visualDiagnosticSchema,
  type VisualScoreArtifact,
  visualScoreArtifactSchema,
  type VisualTopIssue,
} from "./score.ts";

export { type WebTarget, webTargetSchema } from "./target.ts";

export {
  type ContractScope,
  contractScopeSchema,
  type ExpectStyle,
  expectStyleSchema,
  expectSizeSchema,
  pageScopeSchema,
  type ProfileName,
  profileSchema,
  type ProfileOverrides,
  profileOverridesSchema,
  regionScopeSchema,
  type RunType,
  runTypeSchema,
  type StyleCheckPoint,
  type StyleToleranceOverrides,
  styleToleranceOverridesSchema,
  type VerificationContract,
  verificationContractSchema,
  viewportSchema,
  type VisualMask,
  visualMaskSchema,
} from "./visual-contract.ts";
