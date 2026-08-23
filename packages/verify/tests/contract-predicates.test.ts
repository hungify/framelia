import { describe, expect, it } from "vitest";

import {
  sameGateEligible,
  sameProfileOverrides,
  sameStyleGateEligible,
} from "../src/done-gate/contract-predicates.ts";

describe("sameProfileOverrides", () => {
  it("treats an explicit maxDiffPixels: null as matching an omitted override on the page profile", () => {
    // Regression guard: comparing literal override presence (rather than each side's
    // effective, profile-resolved threshold) false-mismatched a page contract that
    // explicitly restates page's own default (`maxDiffPixels: null`) against evidence
    // that simply omitted the override -- both apply the identical no-cap threshold.
    expect(sameProfileOverrides("page", {}, { maxDiffPixels: null })).toBe(true);
    expect(sameProfileOverrides("page", { maxDiffPixels: null }, {})).toBe(true);
  });

  it("still flags maxDiffPixels: null against omitted on a profile whose default is a real cap", () => {
    // component/strict's own default is 500 (not null) -- explicit null ("disable cap")
    // and omitted (falls back to the 500 cap) resolve to genuinely different thresholds
    // here, unlike the page-profile case above.
    expect(sameProfileOverrides("component/strict", {}, { maxDiffPixels: null })).toBe(false);
    expect(sameProfileOverrides("component/strict", { maxDiffPixels: null }, {})).toBe(false);
  });

  it("treats an override that merely restates the profile's own default as matching an omitted override", () => {
    expect(sameProfileOverrides("component/strict", {}, { minMatch: 0.995 })).toBe(true);
    expect(sameProfileOverrides("page", {}, { minSSIM: 0.97 })).toBe(true);
  });

  it("still rejects genuinely different thresholds", () => {
    expect(sameProfileOverrides("component/strict", {}, { minMatch: 0.999 })).toBe(false);
    expect(sameProfileOverrides("page", { maxDiffPixels: 10 }, { maxDiffPixels: 20 })).toBe(false);
  });
});

describe("sameGateEligible", () => {
  it("treats an explicit restatement of the profile's own default as matching an omitted flag", () => {
    // component/strict's own default is gateEligible: true -- an explicit `true` and an
    // omitted flag both resolve to the same effective eligibility.
    expect(sameGateEligible("component/strict", undefined, true)).toBe(true);
    expect(sameGateEligible("component/strict", true, undefined)).toBe(true);
    // component/dev's own default is gateEligible: false -- same reasoning, opposite value.
    expect(sameGateEligible("component/dev", undefined, false)).toBe(true);
    expect(sameGateEligible("component/dev", false, undefined)).toBe(true);
  });

  it("rejects a genuine difference from the profile's default", () => {
    expect(sameGateEligible("component/strict", undefined, false)).toBe(false);
    expect(sameGateEligible("component/dev", undefined, true)).toBe(false);
    expect(sameGateEligible("component/strict", true, false)).toBe(false);
  });
});

describe("sameStyleGateEligible", () => {
  it("treats an explicit restatement of the profile's own default (false everywhere) as matching an omitted flag", () => {
    expect(sameStyleGateEligible("page", undefined, false)).toBe(true);
    expect(sameStyleGateEligible("page", false, undefined)).toBe(true);
    expect(sameStyleGateEligible("component/strict", undefined, false)).toBe(true);
  });

  it("rejects a genuine difference from the profile's default", () => {
    expect(sameStyleGateEligible("page", undefined, true)).toBe(false);
    expect(sameStyleGateEligible("page", true, undefined)).toBe(false);
    expect(sameStyleGateEligible("component/strict", true, false)).toBe(false);
  });
});
