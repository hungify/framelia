import { describe, expect, it } from "vitest";

import { contractForAttempt, inspectedAttempt } from "../lib/attempt-evidence";
import { dashboardMockRun } from "../mocks/dashboard";

const contract = dashboardMockRun.contracts[0]!;
const retry = "checkout.desktop@chromium#0::attempt-0";
const selected = "checkout.desktop@chromium#0::attempt-1";

describe("inspectedAttempt", () => {
  it("only reports a non-selected attempt", () => {
    expect(inspectedAttempt(contract, retry)?.retryIndex).toBe(0);
    expect(inspectedAttempt(contract, selected)).toBeUndefined();
    expect(inspectedAttempt(contract, "unknown")).toBeUndefined();
    expect(inspectedAttempt(contract, undefined)).toBeUndefined();
  });
});

describe("contractForAttempt", () => {
  it("returns the contract itself for the selected attempt", () => {
    expect(contractForAttempt(contract, selected)).toBe(contract);
    expect(contractForAttempt(contract, undefined)).toBe(contract);
  });

  it("swaps in the retry's own evidence, dropping the selected attempt's sizes", () => {
    const view = contractForAttempt(contract, retry);
    expect(view.actual?.path).toBe("mock/checkout-actual-attempt-0.svg");
    expect(view.actual?.width).toBeUndefined();
    expect(view.baseline?.path).toBe(contract.baseline?.path);
    expect(view.blockers).toEqual([]);
  });

  it("explains unavailable retry evidence", () => {
    const withMissing = {
      ...contract,
      attempts: contract.attempts!.map((attempt) =>
        attempt.attemptId === retry
          ? {
              ...attempt,
              evidence: {
                ...attempt.evidence,
                actual: { availability: "missing" as const, message: "actual.png was deleted" },
              },
            }
          : attempt,
      ),
    };
    const view = contractForAttempt(withMissing, retry);
    expect(view.actual).toBeUndefined();
    expect(view.blockers).toEqual([
      { code: "ATTEMPT_ACTUAL_MISSING", message: "actual.png was deleted" },
    ]);
  });
});
