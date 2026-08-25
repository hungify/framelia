export { recordStorageState } from "./auth.ts";
export type { RecordStorageStateOptions, RecordStorageStateResult } from "./auth.ts";
export { FigmaBaselineProvider } from "./baseline.ts";
export type {
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
} from "./baseline.ts";
export { compare } from "./compare/index.ts";
export { attributeDiffRegions } from "./compare/attribution.ts";
export type { DiffRegionAttribution, SelectorBounds } from "./compare/attribution.ts";
export type { DiffCluster } from "./compare/pixel.ts";
export {
  checkDoneGate,
  DEFAULT_MAX_BASELINE_AGE_MS,
  DEFAULT_MAX_SCORE_AGE_MS,
} from "./done-gate/index.ts";
export type {
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ViewportVerdict,
} from "./done-gate/index.ts";
export { fetchBaseline, baselineMetaPath, readBaselineMeta } from "./fetch-baseline.ts";
export type { FetchBaselineOptions, FetchBaselineOutcome, BaselineMeta } from "./fetch-baseline.ts";
export { assertProjectRelativePath, loadEnvFiles, loadProjectEnv } from "./load-env.ts";
export { runWithConcurrency } from "./concurrency.ts";
export { resolveArtifactPath } from "./paths.ts";
export { checkBaselineStaleness, DEFAULT_MAX_BASELINE_AGE_DAYS } from "./staleness.ts";
export type { StalenessOptions } from "./staleness.ts";
export {
  getProfile,
  PROFILES,
  resolveDisplayThreshold,
  resolveStyleGateEligible,
} from "./profiles.ts";
export type { Profile, ThresholdOverrideSource, StyleGateEligibleSource } from "./profiles.ts";
export { doneGateFromArtifact, writeVerificationArtifact } from "./verify.ts";
export { SCHEMA_VERSION, AppError } from "./types.ts";
export { RUN_ARTIFACT, FIGMA_BASELINE_ARTIFACT, WEB_BASELINE_ARTIFACT } from "./artifacts.ts";
export {
  DEFAULT_IMAGE_SCALE,
  EXIT_OK,
  EXIT_PREFLIGHT_FAILED,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
} from "./constants.ts";
export type {
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
  ContractDefaults,
  ExpectSize,
  FidelityErrorCode,
  BaselineEvidence,
  FigmaBaselineEvidence,
  MaskBounds,
  ProfileName,
  ProfileOverrides,
  RejectResult,
  RunType,
  Stability,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
} from "./types.ts";
export {
  profileSchema,
  runTypeSchema,
  viewportSchema,
  expectSizeSchema,
  expectStyleSchema,
  baselineSchema,
  figmaBaselineSchema,
  webTargetSchema,
  contractScopeSchema,
  verificationContractSchema,
  verificationRequestSchema,
  verificationArtifactSchema,
} from "@framelia/contracts";
export type {
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  BaselineSource,
  FigmaBaselineSource,
  WebTarget,
  ContractScope,
  ExpectStyle,
  StyleToleranceOverrides,
} from "@framelia/contracts";
export {
  clearNodeMetaCache,
  deriveExpectStyle,
  getNodeMetadata,
  resolveNodeSpec,
  resolveToken,
} from "./figma-api.ts";
export type { NodeMetadata, ResolveNodeSpecOutcome } from "./figma-api.ts";
export { extractFigmaStyle, expectStyleToSnapshot } from "./figma-node-style.ts";
export type { BoxShadow, CornerRadius, StyleSnapshot } from "./figma-node-style.ts";
export { compareStyles } from "./style-compare.ts";
export {
  pageBaselineImagePath,
  pageBaselineMetaPath,
  promotePageBaseline,
  readPageBaselineMeta,
  resolvePageBaseline,
} from "./page-baseline.ts";
export type {
  PageBaselineMeta,
  PageBaselinePromotion,
  PromotePageBaselineOptions,
  PromotePageBaselineResult,
  ResolvePageBaselineOutcome,
} from "./page-baseline.ts";
export { captureAndPromotePageBaseline } from "./promote-page-baseline.ts";
export type {
  CaptureAndPromotePageBaselineOptions,
  CaptureAndPromotePageBaselineOutcome,
} from "./promote-page-baseline.ts";
