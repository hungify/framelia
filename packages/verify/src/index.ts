export { recordStorageState } from "./auth.ts";
export type { RecordStorageStateOptions, RecordStorageStateResult } from "./auth.ts";
export { FigmaBaselineProvider } from "./baseline.ts";
export type {
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
} from "./baseline.ts";
export { compare } from "./compare/index.ts";
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
export { fetchGold, goldMetaPath, readGoldMeta } from "./fetch-gold.ts";
export type { FetchGoldOptions, FetchGoldOutcome, GoldMeta } from "./fetch-gold.ts";
export { assertProjectRelativePath, loadEnvFiles, loadProjectEnv } from "./load-env.ts";
export { runWithConcurrency } from "./concurrency.ts";
export { resolveArtifactPath } from "./paths.ts";
export { checkGoldStaleness, DEFAULT_MAX_GOLD_AGE_DAYS } from "./staleness.ts";
export type { StalenessOptions } from "./staleness.ts";
export { getProfile, PROFILES } from "./profiles.ts";
export type { Profile } from "./profiles.ts";
export { doneGateFromArtifact, writeVerificationArtifact } from "./verify.ts";
export { SCHEMA_VERSION, AppError } from "./types.ts";
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
  ProfileName,
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
} from "@framelia/contracts";
