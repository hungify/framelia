import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkBaselineStaleness } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-staleness-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function baselineWithMeta(meta: Record<string, unknown>): string {
  const dir = path.join(tmp, `g-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const baseline = path.join(dir, "figma-baseline.png");
  fs.writeFileSync(baseline, "png");
  fs.writeFileSync(path.join(dir, "figma-baseline.meta.json"), JSON.stringify(meta));
  return baseline;
}

const baseMeta = {
  nodeId: "153:5181",
  fileKey: "abc",
  lastModified: "2026-07-01T00:00:00Z",
  apiCallCount: 0,
  apiCallLog: [],
};

describe("baseline staleness (warnings only, never hard-fail)", () => {
  it("no sidecar -> warning", async () => {
    const dir = path.join(tmp, `g-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    const baseline = path.join(dir, "figma-baseline.png");
    fs.writeFileSync(baseline, "png");
    const w = await checkBaselineStaleness(baseline, { token: "" });
    expect(w[0]).toMatch(/no figma-baseline\.meta\.json/);
  });

  it("no token + fresh baseline -> no warnings", async () => {
    const baseline = baselineWithMeta({ ...baseMeta, fetchedAt: new Date().toISOString() });
    const w = await checkBaselineStaleness(baseline, { token: "" });
    expect(w).toHaveLength(0);
  });

  it("no token + old baseline -> time-based heuristic warning (does not detect real changes)", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const baseline = baselineWithMeta({ ...baseMeta, fetchedAt: old });
    const w = await checkBaselineStaleness(baseline, { token: "", maxAgeDays: 14 });
    expect(w[0]).toMatch(/not re-verified in \d+d, no token/);
  });

  function figmaMeta(lastModified: string): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({ lastModified, nodes: { [baseMeta.nodeId]: { document: {} } } }),
        { status: 200 },
      )) as typeof fetch;
  }

  it("token + changed lastModified -> stale warning", async () => {
    const baseline = baselineWithMeta({ ...baseMeta, fetchedAt: new Date().toISOString() });
    const w = await checkBaselineStaleness(baseline, {
      token: "t",
      fetchImpl: figmaMeta("2026-07-18T09:00:00Z"),
    });
    expect(w[0]).toMatch(/baseline may be stale/);
  });

  it("token + unchanged lastModified -> clean", async () => {
    const baseline = baselineWithMeta({ ...baseMeta, fetchedAt: new Date().toISOString() });
    const w = await checkBaselineStaleness(baseline, {
      token: "t",
      fetchImpl: figmaMeta(baseMeta.lastModified),
    });
    expect(w).toHaveLength(0);
  });

  it("token + network failure -> warning + time fallback, never a throw", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const baseline = baselineWithMeta({ ...baseMeta, fetchedAt: old });
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const w = await checkBaselineStaleness(baseline, { token: "t", fetchImpl, maxAgeDays: 14 });
    expect(w.some((x: string) => x.includes("re-check failed"))).toBe(true);
    expect(w.some((x: string) => x.includes("not re-verified"))).toBe(true);
  });

  it("invalid fetchedAt reports unknown freshness", async () => {
    const baseline = baselineWithMeta({ ...baseMeta, fetchedAt: "not-a-date" });
    const w = await checkBaselineStaleness(baseline, { token: "" });
    expect(w.some((warning: string) => warning.includes("no valid fetchedAt"))).toBe(true);
  });

  it("missing lastModified falls back to age check", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const baseline = baselineWithMeta({ ...baseMeta, lastModified: null, fetchedAt: old });
    const w = await checkBaselineStaleness(baseline, {
      token: "t",
      fetchImpl: figmaMeta(baseMeta.lastModified),
      maxAgeDays: 14,
    });
    expect(w.some((warning: string) => warning.includes("lacks a usable lastModified"))).toBe(true);
    expect(w.some((warning: string) => warning.includes("not re-verified"))).toBe(true);
  });
});
