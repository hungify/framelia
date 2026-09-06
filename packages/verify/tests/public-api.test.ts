import { describe, expect, it } from "vitest";

import * as cliApi from "../src/cli.ts";
import type {
  CaptureAndPromotePageBaselineOptions,
  CaptureAndPromotePageBaselineOutcome,
  RecordStorageStateOptions,
  RecordStorageStateResult,
  SuggestMasksForUrlOptions,
  SuggestMasksForUrlOutcome,
} from "../src/cli.ts";
import * as publicApi from "../src/index.ts";
// Type-only half of each subpath's surface: importing these here means
// `tsc --noEmit` fails immediately if any is ever renamed or removed --
// these have no runtime presence, so the Object.keys() snapshots below
// can't see them.
import type {
  AppErrorCode,
  BaselineEvidence,
  BaselineMeta,
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
  BoxShadow,
  CaptureDefaults,
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
  ContractFreshnessReceipt,
  CornerRadius,
  DiffCluster,
  DiffRegionAttribution,
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ExpectSize,
  FetchBaselineOptions,
  FetchBaselineOutcome,
  FidelityErrorCode,
  FigmaBaselineEvidence,
  MaskBounds,
  MaskSuggestion,
  MaskSuggestionHeuristic,
  NodeMetadata,
  PageBaselineMeta,
  PageBaselinePromotion,
  ProfileName,
  ProfileOverrides,
  PromotePageBaselineOptions,
  PromotePageBaselineResult,
  ReadContractEntryOutcome,
  RejectResult,
  ResolveNodeSpecOutcome,
  ResolvePageBaselineOutcome,
  RunType,
  SelectorBounds,
  Stability,
  StalenessOptions,
  StyleSnapshot,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
  ViewportVerdict,
} from "../src/index.ts";
import * as internalApi from "../src/internal.ts";
import type {
  CaptureCoreOutcome,
  CaptureEvidence,
  FontReadiness,
  MaskEvidence,
  ReadyCaptureSpec,
} from "../src/internal.ts";
import * as testingApi from "../src/testing.ts";

/** Referenced only so the type-only imports above aren't dead code and every
 *  name is provably still resolvable by the type checker. Never constructed. */
export type PublicTypeSurface = [
  AppErrorCode,
  BaselineEvidence,
  BaselineMeta,
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
  BoxShadow,
  CaptureDefaults,
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
  ContractFreshnessReceipt,
  CornerRadius,
  DiffCluster,
  DiffRegionAttribution,
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ExpectSize,
  FetchBaselineOptions,
  FetchBaselineOutcome,
  FidelityErrorCode,
  FigmaBaselineEvidence,
  MaskBounds,
  MaskSuggestion,
  MaskSuggestionHeuristic,
  NodeMetadata,
  PageBaselineMeta,
  PageBaselinePromotion,
  ProfileName,
  ProfileOverrides,
  PromotePageBaselineOptions,
  PromotePageBaselineResult,
  ReadContractEntryOutcome,
  RejectResult,
  ResolveNodeSpecOutcome,
  ResolvePageBaselineOutcome,
  RunType,
  SelectorBounds,
  Stability,
  StalenessOptions,
  StyleSnapshot,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
  ViewportVerdict,
];

export type CliTypeSurface = [
  CaptureAndPromotePageBaselineOptions,
  CaptureAndPromotePageBaselineOutcome,
  RecordStorageStateOptions,
  RecordStorageStateResult,
  SuggestMasksForUrlOptions,
  SuggestMasksForUrlOutcome,
];

export type InternalTypeSurface = [
  CaptureCoreOutcome,
  CaptureEvidence,
  FontReadiness,
  MaskEvidence,
  ReadyCaptureSpec,
];

/**
 * Exact snapshot of every runtime-visible name re-exported from each of
 * this package's three subpaths (schemas, functions, classes, constants --
 * type-only exports have no runtime presence and are separately guarded
 * above via a compile-time reference). If any of these tests starts
 * failing, an export was added, removed, or renamed: that's a
 * compatibility event for real consumers (packages/cli, packages/
 * dashboard-server, packages/playwright all import from these three
 * subpaths), requiring a changeset, not an incidental refactor.
 */
const EXPECTED_INDEX_EXPORTS = [
  "AppError",
  "DEFAULT_IMAGE_SCALE",
  "DEFAULT_MASK_SUGGESTION_HEURISTICS",
  "DEFAULT_MAX_BASELINE_AGE_DAYS",
  "DEFAULT_MAX_BASELINE_AGE_MS",
  "DEFAULT_MAX_SCORE_AGE_MS",
  "EXIT_OK",
  "EXIT_PREFLIGHT_FAILED",
  "EXIT_USAGE_ERROR",
  "EXIT_VISUAL_FAIL",
  "FIGMA_BASELINE_ARTIFACT",
  "FigmaBaselineProvider",
  "JSON_INDENT_SPACES",
  "RUN_ARTIFACT",
  "SCHEMA_VERSION",
  "WEB_BASELINE_ARTIFACT",
  "assertProjectRelativePath",
  "attributeDiffRegions",
  "baselineMetaPath",
  "checkBaselineStaleness",
  "checkDoneGate",
  "clearNodeMetaCache",
  "compare",
  "compareStyles",
  "contractFreshnessPath",
  "deriveExpectStyle",
  "doneGateFromArtifact",
  "expectStyleToSnapshot",
  "extractFigmaStyle",
  "fetchBaseline",
  "getNodeMetadata",
  "isContractFresh",
  "loadEnvFiles",
  "loadProjectEnv",
  "pageBaselineImagePath",
  "pageBaselineMetaPath",
  "promotePageBaseline",
  "readBaselineMeta",
  "readContractEntry",
  "readContractFreshness",
  "readPageBaselineMeta",
  "resolveArtifactPath",
  "resolveNodeSpec",
  "resolvePageBaseline",
  "resolveToken",
  "runWithConcurrency",
  "suggestMasks",
  "writeContractFreshness",
  "writeVerificationArtifact",
];

const EXPECTED_CLI_EXPORTS = [
  "captureAndPromotePageBaseline",
  "recordStorageState",
  "suggestMasksForUrl",
];

const EXPECTED_INTERNAL_EXPORTS = [
  "captureReadyPage",
  "checkMaskAreaRatio",
  "readPng",
  "unionArea",
];

const EXPECTED_TESTING_EXPORTS = ["makeSolidPng"];

describe("public API surface", () => {
  it("'.' (src/index.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(publicApi).toSorted()).toEqual(EXPECTED_INDEX_EXPORTS);
  });

  it("'./cli' (src/cli.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(cliApi).toSorted()).toEqual(EXPECTED_CLI_EXPORTS);
  });

  it("'./internal' (src/internal.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(internalApi).toSorted()).toEqual(EXPECTED_INTERNAL_EXPORTS);
  });

  it("'./testing' (src/testing.ts) publishes fixtures only", () => {
    expect(Object.keys(testingApi).toSorted()).toEqual(EXPECTED_TESTING_EXPORTS);
  });
});
