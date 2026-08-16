import type { DashboardContractResult, DashboardEvent } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import { ReporterStore } from "../src/reporter-store.ts";

function passedResult(id: string): DashboardContractResult {
  return {
    id,
    name: id,
    tags: [],
    status: "passed",
    phase: "complete",
    baselineKind: "figma",
    capture: { kind: "viewport", viewport: { width: 100, height: 80 } },
    blockers: [],
  };
}

describe("ReporterStore", () => {
  it("seeds every contract as queued", () => {
    const store = new ReporterStore([
      { id: "a", name: "a", tags: [] },
      { id: "b", name: "b", tags: [] },
    ]);
    const run = store.snapshot();
    expect(run.contracts.map((c) => c.status)).toEqual(["queued", "queued"]);
    expect(run.status).toBe("queued");
  });

  it("recordResult transitions a contract from queued to terminal and emits one event", () => {
    const store = new ReporterStore([{ id: "a", name: "a", tags: [] }]);
    const events: DashboardEvent[] = [];
    store.subscribe((event) => events.push(event));

    store.recordResult("a", passedResult("a"));

    const run = store.snapshot();
    expect(run.contracts[0]).toMatchObject({ id: "a", status: "passed" });
    expect(run.status).toBe("passed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ contractId: "a", status: "passed" });
  });

  it("is order-independent across results completing in any order", () => {
    const store = new ReporterStore([
      { id: "a", name: "a", tags: [] },
      { id: "b", name: "b", tags: [] },
      { id: "c", name: "c", tags: [] },
    ]);

    store.recordResult("c", passedResult("c"));
    store.recordResult("a", passedResult("a"));
    store.recordResult("b", { ...passedResult("b"), status: "failed" });

    const run = store.snapshot();
    expect(run.summary).toMatchObject({ total: 3, passed: 2, failed: 1, queued: 0 });
    expect(run.status).toBe("failed");
  });

  it("ignores recordResult for an unknown contract id instead of growing the run unbounded", () => {
    const store = new ReporterStore([{ id: "a", name: "a", tags: [] }]);
    store.recordResult("does-not-exist", passedResult("does-not-exist"));
    expect(store.snapshot().contracts).toHaveLength(1);
  });

  it("reports an empty run cleanly when zero tests were seeded", () => {
    const store = new ReporterStore([]);
    store.finish();
    const run = store.snapshot();
    expect(run.contracts).toEqual([]);
    expect(run.summary.total).toBe(0);
    expect(run.status).toBe("passed");
    expect(run.finishedAt).toBeDefined();
  });

  it("tracks attached files alongside recorded results", () => {
    const store = new ReporterStore([{ id: "a", name: "a", tags: [] }]);
    store.recordResult("a", passedResult("a"), [["contracts/a/actual.png", "/tmp/actual.png"]]);
    expect(store.files().get("contracts/a/actual.png")).toBe("/tmp/actual.png");
  });
});
