/**
 * Node-only verification engine. The root avoids loading a real @playwright/test
 * instance; ./cli owns browser-launching helpers such as recordStorageState.
 */
export { readContractEntry } from "./contract-file.ts";
export type { ReadContractEntryOutcome } from "./contract-file.ts";
export {
  contractFreshnessPath,
  isContractFresh,
  readContractFreshness,
  writeContractFreshness,
} from "./contract-freshness.ts";
export type { ContractFreshnessReceipt } from "./contract-freshness.ts";
export { FigmaBaselineProvider } from "./baseline/provider.ts";
export type {
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
} from "./baseline/provider.ts";
export { compare } from "./compare/index.ts";
export { attributeDiffRegions } from "./compare/attribution.ts";
export type { DiffRegionAttribution, SelectorBounds } from "./compare/attribution.ts";
export type { DiffCluster } from "./compare/pixel.ts";
export { canonicalJson, canonicalJsonDigest } from "./canonical-json.ts";
export type { CanonicalJsonValue } from "./canonical-json.ts";
export { portableErrorMessage, sanitizePortableValue } from "./portable.ts";
export { fetchBaseline, baselineMetaPath, readBaselineMeta } from "./baseline/figma-fetch.ts";
export type {
  FetchBaselineOptions,
  FetchBaselineOutcome,
  BaselineMeta,
} from "./baseline/figma-fetch.ts";
export { readPinnedBaseline } from "./pinned-baseline.ts";
export type { PinnedBaseline } from "./pinned-baseline.ts";
export {
  assertRawFileState,
  publishBaselineSnapshot,
  readRawFileState,
  stageFigmaBaseline,
  withAuthoringLock,
  writeAuthoredContract,
} from "./authoring.ts";
export type {
  AuthoringLockDependencies,
  FetchBaselineFn,
  RawFileState,
  StageFigmaBaselineOptions,
  StagedBaselineSnapshot,
} from "./authoring.ts";
export {
  assertNoPendingMigrationTransaction,
  clearMigrationTransaction,
  migrationTransactionPath,
  readMigrationTransaction,
  writeMigrationTransaction,
} from "./migration.ts";
export type { MigrationTransactionRecord, MigrationTransactionTarget } from "./migration.ts";
export { assertProjectRelativePath, loadEnvFiles, loadProjectEnv } from "./load-env.ts";
export { fsyncDirectory, writeFileAtomic } from "./fs-atomic.ts";
export { runWithConcurrency } from "./concurrency.ts";
export { resolveArtifactPath } from "./paths.ts";
export { checkBaselineStaleness, DEFAULT_MAX_BASELINE_AGE_DAYS } from "./staleness.ts";
export type { StalenessOptions } from "./staleness.ts";
export { SCHEMA_VERSION, AppError } from "./types.ts";
export type { AppErrorCode } from "./types.ts";
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
  CaptureDefaults,
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
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
} from "./baseline/page.ts";
export type {
  PageBaselineMeta,
  PageBaselinePromotion,
  PromotePageBaselineOptions,
  PromotePageBaselineResult,
  ResolvePageBaselineOutcome,
} from "./baseline/page.ts";
// captureAndPromotePageBaseline (baseline/promote-page.ts) lives in ./cli.ts, not here.
export { DEFAULT_MASK_SUGGESTION_HEURISTICS, suggestMasks } from "./masks/heuristics.ts";
export type { MaskSuggestion, MaskSuggestionHeuristic } from "./masks/heuristics.ts";
// suggestMasksForUrl (masks/suggest-for-url.ts) lives in ./cli.ts, not here.
