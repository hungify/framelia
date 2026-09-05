import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { profileOverridesSchema } from "@framelia/contracts";
import type { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { compare } from "../src/index.ts";
import { makeSolidPng, padTo, writePng } from "../src/internal.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-compare-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function write(png: PNG, name: string): string {
  const p = path.join(tmp, `${n++}-${name}.png`);
  writePng(p, png);
  return p;
}

function outDir(): string {
  const p = path.join(tmp, `out-${n++}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function withRect(
  base: PNG,
  rect: { x: number; y: number; w: number; h: number },
  rgba: [number, number, number, number],
): PNG {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (base.width * y + x) << 2;
      base.data[i] = rgba[0];
      base.data[i + 1] = rgba[1];
      base.data[i + 2] = rgba[2];
      base.data[i + 3] = rgba[3];
    }
  }
  return base;
}

describe("compare pipeline", () => {
  it("passes on identical images", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const actual = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "actual");
    const dir = outDir();
    const r = compare(baseline, actual, dir, { profile: "component/strict" });
    expect(r.pass).toBe(true);
    expect(r.matchRatio).toBe(1);
    expect(r.areaGapPercent).toBe(0);
    expect(r.topIssues).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "diff.png"))).toBe(true);
  });

  it("fails on a broken region (pixel + budget)", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const broken = withRect(
      makeSolidPng(200, 100, [240, 240, 240, 255]),
      {
        x: 20,
        y: 20,
        w: 100,
        h: 50,
      },
      [200, 30, 30, 255],
    );
    const actual = write(broken, "actual");
    const r = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.kind === "pixel")).toBe(true);
    expect(r.topIssues.every((i) => i.kind !== "pixel" || i.repairCandidate === false)).toBe(true);
  });

  it("area-gap over threshold short-circuits downstream signals with a size topIssue", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const actual = write(makeSolidPng(240, 120, [240, 240, 240, 255]), "actual");
    const r = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(false);
    expect(r.areaGapPercent).toBeGreaterThan(2);
    expect(r.matchRatio).toBeNull();
    expect(r.ssim).toBeNull();
    expect(r.avgDeltaE).toBeNull();
    expect(r.diffPath).toBeNull();
    expect(r.topIssues).toHaveLength(1);
    expect(r.topIssues[0]?.kind).toBe("size");
    expect(r.topIssues[0]?.severity).toBe("high");
    expect(r.topIssues[0]?.repairCandidate).toBe(true);
  });

  it("small size drift under areaGap threshold still compares (pad align)", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const actual = write(makeSolidPng(201, 100, [240, 240, 240, 255]), "actual");
    const r = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(r.matchRatio).not.toBeNull();
    expect(r.resizedForCompare).toBe(true);
  });

  it("padTo uses border color instead of white for dark images", () => {
    const src = makeSolidPng(10, 10, [20, 20, 24, 255]);
    const padded = padTo(src, 12, 12);
    const i = (12 * 11 + 11) << 2;
    expect(padded.data[i]).toBeLessThan(40);
    expect(padded.data[i + 1]).toBeLessThan(40);
  });

  it("dark compare pads with border color so smaller actual still passes", () => {
    const dark: [number, number, number, number] = [20, 20, 24, 255];
    const baseline = write(makeSolidPng(200, 100, dark), "dark-baseline");
    const actual = write(makeSolidPng(198, 98, dark), "dark-actual");
    const r = compare(baseline, actual, outDir(), { profile: "component/dev" });
    expect(r.pass).toBe(true);
    expect(r.resizedForCompare).toBe(true);
    expect(r.matchRatio).toBe(1);
    expect(r.topIssues.some((i) => i.kind === "pixel" && i.severity === "high")).toBe(false);
  });

  it("expect-size mismatch fails even when images match", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const actual = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "actual");
    const r = compare(baseline, actual, outDir(), {
      profile: "component/strict",
      expectSize: { width: 544, height: 464 },
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.kind === "expect-size")).toBe(true);
    expect(r.topIssues.some((i) => i.kind === "expect-size" && i.repairCandidate === true)).toBe(
      true,
    );
  });

  it("pass is derived from per-signal thresholds only", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const actual = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "actual");
    const r = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(true);

    const broken = withRect(
      makeSolidPng(200, 100, [240, 240, 240, 255]),
      {
        x: 0,
        y: 0,
        w: 200,
        h: 60,
      },
      [10, 10, 10, 255],
    );
    const badActual = write(broken, "bad");
    const bad = compare(baseline, badActual, outDir(), { profile: "component/strict" });
    expect(bad.pass).toBe(false);
    expect(bad.topIssues.length).toBeGreaterThan(0);
  });

  it("passes despite a broken region when that region is declared as a mask", () => {
    const baseline = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "baseline");
    const broken = withRect(
      makeSolidPng(200, 100, [240, 240, 240, 255]),
      { x: 20, y: 20, w: 100, h: 50 },
      [200, 30, 30, 255],
    );
    const actual = write(broken, "actual");

    const unmasked = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(unmasked.pass).toBe(false);

    const masked = compare(baseline, actual, outDir(), {
      profile: "component/strict",
      maskBounds: [{ x: 20, y: 20, width: 100, height: 50 }],
    });
    expect(masked.pass).toBe(true);
    expect(masked.matchRatio).toBe(1);
    expect(masked.ssim).toBe(1);
    expect(masked.avgDeltaE).toBe(0);
    expect(masked.clusterFail).toBe(false);
    expect(masked.topIssues).toHaveLength(0);
  });

  it("flags color mismatch via deltaE on recolor", () => {
    const baseline = write(makeSolidPng(200, 100, [0, 120, 220, 255]), "baseline");
    const actual = write(makeSolidPng(200, 100, [50, 170, 120, 255]), "actual");
    const r = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(false);
    expect(r.avgDeltaE).not.toBeNull();
    expect(r.avgDeltaE as number).toBeGreaterThan(3);
  });

  it("dispersed residuals stay low severity (text rasterization class)", () => {
    const baselinePng = makeSolidPng(800, 600, [240, 240, 240, 255]);
    const hot = makeSolidPng(800, 600, [240, 240, 240, 255]);
    let placed = 0;
    for (let y = 0; y < 600 && placed < 100; y += 60) {
      for (let x = 0; x < 800 && placed < 100; x += 80) {
        const i = (800 * y + x) << 2;
        hot.data[i] = 200;
        hot.data[i + 1] = 30;
        hot.data[i + 2] = 30;
        hot.data[i + 3] = 255;
        placed += 1;
      }
    }
    const baseline = write(baselinePng, "baseline");
    const actual = write(hot, "actual");
    const r = compare(baseline, actual, outDir(), { profile: "page" });
    expect(r.pass).toBe(true);
    expect(r.warnings).toHaveLength(0);
    expect(r.topIssues.some((i) => i.kind === "residual" && i.severity === "low")).toBe(true);
  });

  it("connected residual cluster blocks done-gate even when signal thresholds pass", () => {
    const baselinePng = makeSolidPng(800, 600, [240, 240, 240, 255]);
    const hot = makeSolidPng(800, 600, [240, 240, 240, 255]);
    for (let i = 0; i < 100; i++) {
      for (const x of [100 + i, 101 + i]) {
        const y = 100 + i;
        const offset = (800 * y + x) << 2;
        hot.data[offset] = 200;
        hot.data[offset + 1] = 30;
        hot.data[offset + 2] = 30;
        hot.data[offset + 3] = 255;
      }
    }
    const r = compare(write(baselinePng, "baseline"), write(hot, "actual"), outDir(), {
      profile: "page",
    });
    expect(r.pass).toBe(true);
    expect(r.warnings.some((warning) => warning.includes("largest residual cluster"))).toBe(true);
    expect(
      r.topIssues.some((issue) => issue.kind === "residual" && issue.severity === "medium"),
    ).toBe(true);
  });

  it("clusterCheck override fails a component whose defect is concentrated in one region, even though every other signal passes", () => {
    const baselinePng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    let actualPng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    actualPng = withRect(actualPng, { x: 10, y: 10, w: 16, h: 16 }, [150, 150, 150, 255]);
    // Stray pixel far from the concentrated block: stretches the diff bounding box across
    // most of the image, diluting avgDeltaE (computed over the whole bbox, not just the
    // diffing pixels) so this test isolates the cluster signal from the color signal.
    actualPng = withRect(actualPng, { x: 299, y: 299, w: 1, h: 1 }, [150, 150, 150, 255]);

    const baseline = write(baselinePng, "baseline");
    const actual = write(actualPng, "actual");
    // component/strict's own `cluster` setting is false -- this proves the `clusterCheck`
    // override (what resolveFigmaCompareOptions uses for the component default) independently
    // fails a concentrated defect that clears matchRatio, maxDiffPixels, SSIM, and avgDeltaE.
    const r = compare(baseline, actual, outDir(), {
      profile: "component/strict",
      clusterCheck: true,
    });

    expect(r.matchRatio).not.toBeNull();
    expect(r.matchRatio as number).toBeGreaterThanOrEqual(0.995);
    expect(r.avgDeltaE).not.toBeNull();
    expect(r.avgDeltaE as number).toBeLessThan(3.0);
    expect(r.ssim).toBeGreaterThanOrEqual(0.985);
    expect(r.diffPixels).not.toBeNull();
    expect(r.diffPixels as number).toBeLessThanOrEqual(500);
    expect(r.clusterFail).toBe(true);
    expect(r.pass).toBe(false);
  });

  it("profileOverrides.minMatch tightens pass/fail beyond component/strict's own default", () => {
    const baselinePng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    let actualPng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    actualPng = withRect(actualPng, { x: 10, y: 10, w: 16, h: 16 }, [150, 150, 150, 255]);
    // Stray pixel far from the block, same dilution trick as the clusterCheck fixture above:
    // stretches the diff bounding box so avgDeltaE/SSIM stay well inside profile defaults and
    // only matchRatio is in play.
    actualPng = withRect(actualPng, { x: 299, y: 299, w: 1, h: 1 }, [150, 150, 150, 255]);

    const baseline = write(baselinePng, "baseline");
    const actual = write(actualPng, "actual");

    const withoutOverride = compare(baseline, actual, outDir(), { profile: "component/strict" });
    expect(withoutOverride.matchRatio).not.toBeNull();
    expect(withoutOverride.matchRatio as number).toBeGreaterThanOrEqual(0.995);
    expect(withoutOverride.matchRatio as number).toBeLessThan(0.999);
    expect(withoutOverride.pass).toBe(true);

    // Same fixture, only minMatch raised past the default -- proves the override, not the
    // fixture, is what flips pass/fail.
    const withOverride = compare(baseline, actual, outDir(), {
      profile: "component/strict",
      profileOverrides: { minMatch: 0.999 },
    });
    expect(withOverride.matchRatio).toBe(withoutOverride.matchRatio);
    expect(withOverride.pass).toBe(false);
    expect(withOverride.topIssues.some((issue) => issue.kind === "pixel")).toBe(true);
  });

  it("profileOverrides.maxDiffPixels adds a hard cap where the page profile has none by default", () => {
    const baselinePng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    let actualPng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    actualPng = withRect(actualPng, { x: 10, y: 10, w: 4, h: 4 }, [150, 150, 150, 255]);
    actualPng = withRect(actualPng, { x: 299, y: 299, w: 1, h: 1 }, [150, 150, 150, 255]);

    const baseline = write(baselinePng, "baseline");
    const actual = write(actualPng, "actual");

    const withoutOverride = compare(baseline, actual, outDir(), { profile: "page" });
    expect(withoutOverride.diffPixels).not.toBeNull();
    expect(withoutOverride.diffPixels as number).toBeGreaterThan(10);
    expect(withoutOverride.pass).toBe(true);

    // page's own maxDiffPixels default is null (no cap) -- proves the override adds a cap
    // that wasn't there, not just tightens an existing one.
    const withOverride = compare(baseline, actual, outDir(), {
      profile: "page",
      profileOverrides: { maxDiffPixels: 10 },
    });
    expect(withOverride.diffPixels).toBe(withoutOverride.diffPixels);
    expect(withOverride.pass).toBe(false);
  });

  it("profileOverrides with an explicit undefined value keeps the profile's own default", () => {
    // Regression guard: a plain `{...profile, ...overrides}` spread lets a present-but-
    // `undefined` key (e.g. built from `{ minMatch: maybeUndefinedVar }`) clobber the
    // resolved default with `undefined`. Every numeric threshold comparison against
    // `undefined` is false, so the comparison both fails pass *and* silently omits the
    // diagnostic that would normally explain a maxDiffPixels/minMatch failure.
    const baselinePng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    let actualPng = makeSolidPng(300, 300, [235, 235, 235, 255]);
    actualPng = withRect(actualPng, { x: 10, y: 10, w: 4, h: 4 }, [150, 150, 150, 255]);
    actualPng = withRect(actualPng, { x: 299, y: 299, w: 1, h: 1 }, [150, 150, 150, 255]);

    const baseline = write(baselinePng, "baseline");
    const actual = write(actualPng, "actual");

    const withoutOverride = compare(baseline, actual, outDir(), { profile: "page" });
    expect(withoutOverride.pass).toBe(true);

    const withUndefinedOverride = compare(baseline, actual, outDir(), {
      profile: "page",
      profileOverrides: { minMatch: undefined, maxDiffPixels: undefined },
    });
    expect(withUndefinedOverride.pass).toBe(true);
    expect(withUndefinedOverride.matchRatio).toBe(withoutOverride.matchRatio);
    expect(withUndefinedOverride.topIssues.some((issue) => issue.kind === "pixel")).toBe(false);
  });

  it("profileOverrides schema rejects cluster and stabilityMaxDiffRatio overrides", () => {
    // Regression guard: profileOverridesSchema is the contract-level type that
    // packages/verify's CompareOptions.profileOverrides and packages/playwright's
    // matcher options are typed against. cluster already has its own dedicated
    // clusterCheck field, and nothing in the compare pipeline reads stabilityMaxDiffRatio
    // -- both must stay rejected, not silently accepted as pass-through threshold fields.
    expect(profileOverridesSchema.safeParse({ cluster: true }).success).toBe(false);
    expect(profileOverridesSchema.safeParse({ stabilityMaxDiffRatio: 0.01 }).success).toBe(false);
    expect(profileOverridesSchema.safeParse({ minMatch: 0.999 }).success).toBe(true);
  });
});
