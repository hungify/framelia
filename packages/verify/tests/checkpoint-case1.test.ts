import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { compare } from "../src/index.ts";
import { makeSolidPng, writePng } from "../src/internal.ts";

const fixtures = path.join(import.meta.dirname, "fixtures");
const EXPECT_SIZE = { width: 544, height: 464 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-case1-"));
const baseline = path.join(tmp, "synthetic-baseline.png");
writePng(baseline, makeSolidPng(EXPECT_SIZE.width, EXPECT_SIZE.height, [255, 255, 255, 255]));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("checkpoint case 1 - Frame 27", () => {
  it("comparison baseline exists at expected size", () => {
    expect(fs.existsSync(baseline)).toBe(true);
  });

  it("FAIL: broken actual (post-wipe login) fails with size + expect-size issues", () => {
    const r = compare(baseline, path.join(fixtures, "frame27-broken-actual.png"), tmp, {
      profile: "component/strict",
      expectSize: EXPECT_SIZE,
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.kind === "expect-size")).toBe(true);
    expect(r.topIssues.some((i) => i.kind === "size" && i.severity === "high")).toBe(true);
    expect(r.matchRatio).toBeNull();
  });

  it("identical baseline passes strict comparison", () => {
    const r = compare(baseline, baseline, tmp, {
      profile: "component/strict",
      expectSize: EXPECT_SIZE,
    });
    expect(r.areaGapPercent).toBe(0);
    expect(r.matchRatio).toBeGreaterThan(0.99);
    expect(r.topIssues.every((i) => i.kind !== "expect-size")).toBe(true);
  });
});
