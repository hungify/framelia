import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.ts";
import type { DashboardAttempt, DashboardContractResult, DashboardRun } from "../src/index.ts";
import * as workflowApi from "../src/workflow-records.ts";
import type {
  AttemptScore,
  AuthoritativeRunRequirements,
  CasePlan,
} from "../src/workflow-records.ts";

export type PublicTypeSurface = [
  AttemptScore,
  AuthoritativeRunRequirements,
  CasePlan,
  DashboardAttempt,
  DashboardContractResult,
  DashboardRun,
];

describe("public API surface", () => {
  it("exports selected-run workflow and dashboard contracts", () => {
    expect(workflowApi.casePlanSchema).toBeDefined();
    expect(workflowApi.attemptScoreSchema).toBeDefined();
    expect(workflowApi.authoritativeRunRequirementsSchema).toBeDefined();
    expect(workflowApi.signedAuthoritativeRunRequirementsSchema).toBeDefined();
    expect(publicApi.dashboardRunSchema).toBeDefined();
  });

  it("keeps the low-level verification request and score contracts", () => {
    expect(publicApi.verificationRequestSchema).toBeDefined();
    expect(publicApi.visualScoreArtifactSchema).toBeDefined();
  });
});
