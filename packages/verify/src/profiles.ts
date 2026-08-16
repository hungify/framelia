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
  },
};

export function getProfile(name: ProfileName): Profile {
  return PROFILES[name];
}
