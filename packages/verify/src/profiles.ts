import type { ProfileName } from "./types.ts";

export interface Profile {
  name: ProfileName;
  minMatch: number;
  maxDiffPixels: number | null;
  minSSIM: number;
  maxAvgDeltaE: number;
  maxAreaGapPercent: number;
  cluster: boolean;
  stabilityMaxDiffRatio: number;
  /** Whether this preset's own threshold is strict enough to block the CI merge gate by
   *  default -- see done-gate/validate.ts. A contract's `gateEligible` override, when set,
   *  takes precedence over this. */
  gateEligible: boolean;
  /** Whether style mismatches (color/typography/corner-radius/etc., see compareStyles())
   *  block the CI merge gate by default -- opt-in, see done-gate/validate.ts. A contract's
   *  `styleGateEligible` override, when set, takes precedence over this. */
  styleGateEligible: boolean;
}

export const PROFILES: Record<ProfileName, Profile> = {
  page: {
    name: "page",
    minMatch: 0.99,
    maxDiffPixels: null,
    minSSIM: 0.97,
    maxAvgDeltaE: 4.0,
    maxAreaGapPercent: 5,
    cluster: true,
    stabilityMaxDiffRatio: 0.002,
    gateEligible: true,
    styleGateEligible: false,
  },
  "component/strict": {
    name: "component/strict",
    minMatch: 0.995,
    maxDiffPixels: 500,
    minSSIM: 0.985,
    maxAvgDeltaE: 3.0,
    maxAreaGapPercent: 2,
    cluster: false,
    stabilityMaxDiffRatio: 0.002,
    gateEligible: true,
    styleGateEligible: false,
  },
  "component/dev": {
    name: "component/dev",
    minMatch: 0.98,
    maxDiffPixels: 2000,
    minSSIM: 0.96,
    maxAvgDeltaE: 5.0,
    maxAreaGapPercent: 5,
    cluster: false,
    stabilityMaxDiffRatio: 0.002,
    gateEligible: false,
    styleGateEligible: false,
  },
};

export function getProfile(name: ProfileName): Profile {
  return PROFILES[name];
}

/** Anything a resolved comparison could carry that overrides the named profile's own
 *  styleGateEligible default -- same reasoning as ThresholdOverrideSource. */
export interface StyleGateEligibleSource {
  profile?: ProfileName;
  styleGateEligible?: boolean;
}

/** A contract's resolved style-gate eligibility: its explicit `styleGateEligible` override
 *  when set, else the resolved profile's own default (see `Profile.styleGateEligible`).
 *  Shared by done-gate/validate.ts (CI gating) and the UI projection (display). */
export function resolveStyleGateEligible(source: StyleGateEligibleSource): boolean {
  return source.styleGateEligible ?? getProfile(source.profile ?? "page").styleGateEligible;
}

/** Anything a resolved comparison could carry that overrides the named profile's own numbers. */
export interface ThresholdOverrideSource {
  profile?: ProfileName;
  clusterCheck?: boolean;
}

/**
 * The concrete threshold values a comparison actually ran against: the named profile's
 * numbers with any per-call overrides layered on top. Takes the whole source object rather
 * than positional (profile, clusterCheck) params so a caller's FrameliaScoreAttachment /
 * VerificationContract can be passed straight through -- a future override field (e.g. a
 * profileOverrides carrying per-field threshold tweaks) only needs one more spread line here,
 * not a signature change at every call site.
 */
export function resolveDisplayThreshold(source: ThresholdOverrideSource): Profile {
  return {
    ...getProfile(source.profile ?? "page"),
    ...(source.clusterCheck !== undefined ? { cluster: source.clusterCheck } : {}),
  };
}
