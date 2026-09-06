import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.ts";
// Type-only half of the public surface: importing these here means `tsc
// --noEmit` fails immediately if any is ever renamed or removed from
// src/index.ts -- these have no runtime presence, so the Object.keys()
// snapshot below can't see them.
import type {
  BaselineSource,
  CaptureDefaults,
  CaptureEvidenceArtifact,
  ContractScope,
  DashboardCaptureEvidence,
  DashboardContractResult,
  DashboardDiagnostic,
  DashboardEvent,
  DashboardEventShape,
  DashboardImageEvidence,
  DashboardMaskEvidence,
  DashboardResolvedThreshold,
  DashboardRun,
  DashboardRunShape,
  DashboardSummary,
  DashboardTopIssue,
  DashboardVerdict,
  ExpectStyle,
  FigmaBaselineSource,
  ProfileName,
  ProfileOverrides,
  ProjectCaptureRegion,
  RunType,
  Stability,
  StyleCheckPoint,
  StyleToleranceOverrides,
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  VisualDiagnostic,
  VisualMask,
  VisualScoreArtifact,
  VisualTopIssue,
  WebTarget,
} from "../src/index.ts";

/** Referenced only so the type-only import above isn't dead code and every
 * name is provably still resolvable by the type checker. Never constructed. */
export type PublicTypeSurface = [
  BaselineSource,
  CaptureDefaults,
  CaptureEvidenceArtifact,
  ContractScope,
  DashboardCaptureEvidence,
  DashboardContractResult,
  DashboardDiagnostic,
  DashboardEvent,
  DashboardEventShape,
  DashboardImageEvidence,
  DashboardMaskEvidence,
  DashboardResolvedThreshold,
  DashboardRun,
  DashboardRunShape,
  DashboardSummary,
  DashboardTopIssue,
  DashboardVerdict,
  ExpectStyle,
  FigmaBaselineSource,
  ProfileName,
  ProfileOverrides,
  ProjectCaptureRegion,
  RunType,
  Stability,
  StyleCheckPoint,
  StyleToleranceOverrides,
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  VisualDiagnostic,
  VisualMask,
  VisualScoreArtifact,
  VisualTopIssue,
  WebTarget,
];

/**
 * Exact snapshot of every runtime-visible name re-exported from src/index.ts
 * (schemas, functions, constants -- type-only exports have no runtime
 * presence and are separately guarded above via a compile-time reference).
 *
 * index.ts is a curated barrel, not `export *` -- this list IS the package's
 * public API. If this test starts failing, an export was added, removed, or
 * renamed: that's a compatibility event requiring a changeset, not an
 * incidental refactor.
 */
const EXPECTED_RUNTIME_EXPORTS = [
  "CONTRACT_ID_PATTERN",
  "DEFAULT_AUTH_STATE_PATH",
  "DEFAULT_DISCOVERY_DIR",
  "DEFAULT_MAX_MASKED_AREA_RATIO",
  "DISCOVERY_DIR_NAME",
  "FIGMA_NODE_ID",
  "FRAMELIA_DIR",
  "MAX_CONTRACTS_PER_REQUEST",
  "MAX_CONTRACT_TIMEOUT_MS",
  "MAX_MASK_SELECTORS",
  "PROFILES",
  "MAX_STABILITY_SAMPLES",
  "LOOPBACK_HOSTNAME_DESCRIPTION",
  "MIN_CONTRACTS_PER_REQUEST",
  "MIN_CONTRACT_TIMEOUT_MS",
  "MIN_STABILITY_SAMPLES",
  "SCHEMA_VERSION",
  "VISUAL_ARTIFACT_DIR_PATTERN",
  "VISUAL_CONTRACT_FILE",
  "VISUAL_VERIFICATIONS_DIR",
  "VISUAL_VERIFICATIONS_ROOT",
  "VISUAL_VERIFICATION_FILE",
  "assembleContractResult",
  "baselineSchema",
  "captureDefaultsSchema",
  "captureEvidenceSchema",
  "captureMaskEvidenceSchema",
  "contractScopeSchema",
  "dashboardEventSchema",
  "dashboardRunSchema",
  "deriveCaptureEvidenceDiagnostics",
  "deriveComparisonSummary",
  "deriveDashboardVerdict",
  "expectSizeSchema",
  "expectStyleSchema",
  "figmaBaselineSchema",
  "getProfile",
  "httpUrlSchema",
  "isLoopbackHostname",
  "isWildcardHostname",
  "nonEmptyTrimmed",
  "pageScopeSchema",
  "profileOverridesSchema",
  "profileSchema",
  "projectCapture",
  "projectCaptureEvidence",
  "regionScopeSchema",
  "resolveDisplayThreshold",
  "resolveStyleGateEligible",
  "runTypeSchema",
  "stabilitySchema",
  "styleToleranceOverridesSchema",
  "toJsonSchema",
  "topIssueSchema",
  "verificationArtifactSchema",
  "verificationContractSchema",
  "verificationRequestSchema",
  "viewportSchema",
  "visualArtifactPath",
  "visualDiagnosticSchema",
  "visualMaskSchema",
  "visualScoreArtifactSchema",
  "webTargetSchema",
].toSorted();

describe("public API surface (src/index.ts)", () => {
  it("matches the exact expected runtime export-name set", () => {
    expect(Object.keys(publicApi).toSorted()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it("keeps DashboardContractResult's identifier un-renamed (deliberately deferred, not forgotten)", () => {
    expect(typeof publicApi.assembleContractResult).toBe("function");
  });
});
