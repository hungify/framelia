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
  BaselineSource,
  BoxShadow,
  CaptureDefaults,
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
  ContractFreshnessReceipt,
  ContractScope,
  CornerRadius,
  DiffCluster,
  DiffRegionAttribution,
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ExpectSize,
  ExpectStyle,
  FetchBaselineOptions,
  FetchBaselineOutcome,
  FidelityErrorCode,
  FigmaBaselineEvidence,
  FigmaBaselineSource,
  MaskBounds,
  MaskSuggestion,
  MaskSuggestionHeuristic,
  NodeMetadata,
  PageBaselineMeta,
  PageBaselinePromotion,
  Profile,
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
  StyleGateEligibleSource,
  StyleSnapshot,
  StyleToleranceOverrides,
  ThresholdOverrideSource,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  ViewportVerdict,
  WebTarget,
} from "../src/index.ts";
import * as internalApi from "../src/internal.ts";
import type {
  CaptureCoreOutcome,
  CaptureEvidence,
  FontReadiness,
  MaskEvidence,
  ReadyCaptureSpec,
} from "../src/internal.ts";

/** Referenced only so the type-only imports above aren't dead code and every
 *  name is provably still resolvable by the type checker. Never constructed. */
export type PublicTypeSurface = [
  AppErrorCode,
  BaselineEvidence,
  BaselineMeta,
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
  BaselineSource,
  BoxShadow,
  CaptureDefaults,
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
  ContractFreshnessReceipt,
  ContractScope,
  CornerRadius,
  DiffCluster,
  DiffRegionAttribution,
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ExpectSize,
  ExpectStyle,
  FetchBaselineOptions,
  FetchBaselineOutcome,
  FidelityErrorCode,
  FigmaBaselineEvidence,
  FigmaBaselineSource,
  MaskBounds,
  MaskSuggestion,
  MaskSuggestionHeuristic,
  NodeMetadata,
  PageBaselineMeta,
  PageBaselinePromotion,
  Profile,
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
  StyleGateEligibleSource,
  StyleSnapshot,
  StyleToleranceOverrides,
  ThresholdOverrideSource,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  ViewportVerdict,
  WebTarget,
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
  "PROFILES",
  "RUN_ARTIFACT",
  "SCHEMA_VERSION",
  "WEB_BASELINE_ARTIFACT",
  "assertProjectRelativePath",
  "attributeDiffRegions",
  "baselineMetaPath",
  "baselineSchema",
  "checkBaselineStaleness",
  "checkDoneGate",
  "clearNodeMetaCache",
  "compare",
  "compareStyles",
  "contractFreshnessPath",
  "contractScopeSchema",
  "deriveExpectStyle",
  "doneGateFromArtifact",
  "expectSizeSchema",
  "expectStyleSchema",
  "expectStyleToSnapshot",
  "extractFigmaStyle",
  "fetchBaseline",
  "figmaBaselineSchema",
  "getNodeMetadata",
  "getProfile",
  "isContractFresh",
  "loadEnvFiles",
  "loadProjectEnv",
  "pageBaselineImagePath",
  "pageBaselineMetaPath",
  "profileSchema",
  "promotePageBaseline",
  "readBaselineMeta",
  "readContractEntry",
  "readContractFreshness",
  "readPageBaselineMeta",
  "resolveArtifactPath",
  "resolveDisplayThreshold",
  "resolveNodeSpec",
  "resolvePageBaseline",
  "resolveStyleGateEligible",
  "resolveToken",
  "runTypeSchema",
  "runWithConcurrency",
  "suggestMasks",
  "verificationArtifactSchema",
  "verificationContractSchema",
  "verificationRequestSchema",
  "viewportSchema",
  "webTargetSchema",
  "writeContractFreshness",
  "writeVerificationArtifact",
];

const EXPECTED_CLI_EXPORTS = [
  "captureAndPromotePageBaseline",
  "recordStorageState",
  "suggestMasksForUrl",
];

const EXPECTED_INTERNAL_EXPORTS = [
  "MASK_COLOR",
  "areaGap",
  "avgDeltaE2000",
  "captureReadyPage",
  "checkMaskAreaRatio",
  "compositeOnCanvas",
  "countRealDiffPixels",
  "diffBoundingBox",
  "diffClusters",
  "largestCluster",
  "largestRealDiffCluster",
  "makeSolidPng",
  "padTo",
  "parseHexRgb",
  "parsePng",
  "pixelCompare",
  "readPng",
  "resolveSelector",
  "settle",
  "ssimCompare",
  "unionArea",
  "writePng",
];

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

  it("re-exports CaptureDefaults/CaptureDefaults-shaped surface, not the old ContractDefaults name", () => {
    // CaptureDefaults is type-only in this package (it's a type alias, not a
    // runtime schema -- verify doesn't re-export captureDefaultsSchema
    // itself), so there's nothing to assert about it at runtime; its
    // resolvability is already guarded by the type-only import block above.
    expect(Object.keys(publicApi)).not.toContain("ContractDefaults");
  });

  it("keeps the three-subpath split isolating real @playwright/test imports: only './cli' constructs a browser", () => {
    // A structural sanity check, not a full re-run of architecture-boundary.test.ts:
    // '.' and './internal' must never re-export the three CLI-only browser-launching
    // actions (recordStorageState, captureAndPromotePageBaseline, suggestMasksForUrl).
    const cliOnlyNames = [
      "recordStorageState",
      "captureAndPromotePageBaseline",
      "suggestMasksForUrl",
    ];
    for (const name of cliOnlyNames) {
      expect(publicApi).not.toHaveProperty(name);
      expect(internalApi).not.toHaveProperty(name);
      expect(cliApi).toHaveProperty(name);
    }
  });
});
