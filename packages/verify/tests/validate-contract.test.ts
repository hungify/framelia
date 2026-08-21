import { describe, expect, it } from "vitest";

import type { DoneGateViewport } from "../src/done-gate/types.ts";
import { validateContract } from "../src/done-gate/validate.ts";

const target = { kind: "web" as const, url: "http://localhost:3000/login" };
const baseline = { kind: "figma" as const, fileKey: "file-key", nodeId: "153:5181" };

const componentContract: DoneGateViewport = {
  viewport: "desktop",
  outDir: "out",
  baseline,
  target,
  profile: "component/strict",
  selector: '[data-testid="auth.login"]',
  expectSize: { width: 544, height: 464 },
};

const pageContract: DoneGateViewport = {
  viewport: "desktop",
  outDir: "out",
  baseline,
  target,
  profile: "page",
  pageReason: "auth flow entry point",
};

describe("validateContract gate eligibility", () => {
  it("passes a default component/strict contract (Issue #10 AC2: default strict threshold passes)", () => {
    expect(validateContract(componentContract)).toEqual([]);
  });

  it("rejects an explicit gateEligible: false override, isolated from other structural reasons (AC1: deliberately loose custom threshold, flagged not gate-eligible, is rejected)", () => {
    // A contract can flag itself not-gate-eligible without ever naming the "dev" preset --
    // exactly the gap #10 exists to close (a custom profileOverrides threshold as loose as
    // component/dev previously sailed through because the old check only matched the name
    // "component/dev" literally).
    const reasons = validateContract({ ...componentContract, gateEligible: false });
    expect(reasons).toContain(
      "done gate requires a gate-eligible threshold; this contract's resolved threshold (profile default or explicit gateEligible override) is not gate-eligible.",
    );
    // Nothing else about this contract is invalid -- the eligibility flag is the only thing
    // that should fire, proving the check is isolated and not accidentally coupled to scope.
    expect(reasons).toHaveLength(1);
  });

  it("rejects component/dev by its own resolved default, same outcome as the old name-based forbid", () => {
    expect(
      validateContract({ ...componentContract, profile: "component/dev" }).some((reason) =>
        reason.includes("not gate-eligible"),
      ),
    ).toBe(true);
  });

  it("lets an explicit gateEligible: true opt component/dev back into gating -- and then requires expectSize like any other gate-eligible component contract (AC3: scope-driven requirement, not a threshold-name match)", () => {
    const { expectSize: _expectSize, ...withoutExpectSize } = componentContract;
    const devOptedIn: DoneGateViewport = {
      ...withoutExpectSize,
      profile: "component/dev",
      gateEligible: true,
    };
    expect(validateContract(devOptedIn)).toContain(
      "gate-eligible component contract requires expectSize.",
    );
    expect(validateContract({ ...devOptedIn, expectSize: { width: 100, height: 100 } })).toEqual(
      [],
    );
  });

  it("does not require expectSize for a component/dev contract left at its own (not gate-eligible) default", () => {
    const { expectSize: _expectSize, ...withoutExpectSize } = componentContract;
    const reasons = validateContract({ ...withoutExpectSize, profile: "component/dev" });
    expect(reasons).not.toContain("gate-eligible component contract requires expectSize.");
  });

  it("does not auto-flip gateEligible just because profileOverrides make the threshold loose", () => {
    // gateEligible is resolved purely from the profile default / explicit override -- it is
    // never inferred from how loose the merged profileOverrides numbers happen to be.
    const loosened: DoneGateViewport = {
      ...componentContract,
      profileOverrides: { minMatch: 0.5, maxDiffPixels: null },
    };
    expect(validateContract(loosened)).toEqual([]);
  });

  it("keeps page-scope structural requirements unaffected by gate eligibility", () => {
    expect(validateContract(pageContract)).toEqual([]);
    const { pageReason: _pageReason, ...withoutPageReason } = pageContract;
    expect(validateContract(withoutPageReason)).toContain("page contract requires pageReason.");
    expect(validateContract({ ...pageContract, gateEligible: false })).toContain(
      "done gate requires a gate-eligible threshold; this contract's resolved threshold (profile default or explicit gateEligible override) is not gate-eligible.",
    );
  });
});
