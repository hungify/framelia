import type { DashboardContractResult } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import {
  buildContractTree,
  filterContracts,
  findContractTreeItem,
  flattenContractTree,
  parseStatusFilter,
  resolveSelectedContract,
  stepContract,
} from "../lib/contract-tree";

function contract(
  partial: Partial<DashboardContractResult> &
    Pick<DashboardContractResult, "id" | "name" | "status">,
): DashboardContractResult {
  return {
    tags: [],
    phase: "complete",
    baselineKind: "figma",
    capture: { kind: "viewport", viewport: { width: 1280, height: 720 } },
    blockers: [],
    ...partial,
  };
}

describe("filterContracts", () => {
  const items = [
    contract({ id: "checkout.desktop", name: "Checkout", status: "failed", tags: ["desktop"] }),
    contract({ id: "header.mobile", name: "Header", status: "passed", tags: ["mobile"] }),
  ];

  it("filters by status and query", () => {
    expect(filterContracts(items, "", "failed").map((item) => item.id)).toEqual([
      "checkout.desktop",
    ]);
    expect(filterContracts(items, "header", "all").map((item) => item.id)).toEqual([
      "header.mobile",
    ]);
    expect(filterContracts(items, "mobile", "passed").map((item) => item.id)).toEqual([
      "header.mobile",
    ]);
  });
});

describe("resolveSelectedContract", () => {
  const items = [
    contract({ id: "a", name: "A", status: "passed" }),
    contract({ id: "b", name: "B", status: "failed" }),
  ];

  it("looks an explicit id up in the whole run, independent of the filter", () => {
    // "b" is filtered out of the displayed list but stays selected -- no fallback.
    expect(resolveSelectedContract(items, [items[0]!], "b")?.id).toBe("b");
    expect(resolveSelectedContract(items, items, "missing")).toBeUndefined();
  });

  it("defaults to the first displayed contract only without an id", () => {
    expect(resolveSelectedContract(items, [items[1]!], undefined)?.id).toBe("b");
    expect(resolveSelectedContract(items, [], undefined)).toBeUndefined();
  });
});

describe("parseStatusFilter", () => {
  it("accepts known statuses and defaults anything else to all", () => {
    expect(parseStatusFilter("failed")).toBe("failed");
    expect(parseStatusFilter("masked-pass")).toBe("masked-pass");
    expect(parseStatusFilter("exploded")).toBe("all");
    expect(parseStatusFilter(["failed"])).toBe("all");
    expect(parseStatusFilter(undefined)).toBe("all");
  });
});

describe("tree-order navigation", () => {
  // Input order interleaves features; the tree groups them, and navigation must follow
  // the tree, not the flat input order.
  const items = [
    contract({ id: "checkout.desktop", name: "C D", status: "passed", feature: "checkout" }),
    contract({ id: "header.mobile", name: "H M", status: "passed", feature: "header" }),
    contract({ id: "checkout.mobile", name: "C M", status: "failed", feature: "checkout" }),
  ];
  const displayed = flattenContractTree(buildContractTree(items));

  it("flattens leaves in displayed (grouped) order", () => {
    expect(displayed.map((item) => item.id)).toEqual([
      "checkout.desktop",
      "checkout.mobile",
      "header.mobile",
    ]);
  });

  it("steps forward/backward with wrap-around", () => {
    expect(stepContract(displayed, "checkout.desktop", 1)?.id).toBe("checkout.mobile");
    expect(stepContract(displayed, "header.mobile", 1)?.id).toBe("checkout.desktop");
    expect(stepContract(displayed, "checkout.desktop", -1)?.id).toBe("header.mobile");
  });

  it("enters the list from either end when the selection is filtered out", () => {
    expect(stepContract(displayed, "hidden", 1)?.id).toBe("checkout.desktop");
    expect(stepContract(displayed, undefined, -1)?.id).toBe("header.mobile");
    expect(stepContract([], "x", 1)).toBeUndefined();
  });
});

describe("buildContractTree", () => {
  it("groups by feature and aggregates worst status", () => {
    const tree = buildContractTree(
      [
        contract({
          id: "checkout.desktop",
          name: "Checkout Desktop",
          status: "passed",
          feature: "checkout",
        }),
        contract({
          id: "checkout.mobile",
          name: "Checkout Mobile",
          status: "failed",
          feature: "checkout",
        }),
        contract({ id: "header.mobile", name: "Header", status: "blocked", feature: "header" }),
      ],
      "suite",
    );

    expect(tree).toHaveLength(2);
    expect(tree[0]?.id).toBe("suite:checkout");
    expect(tree[0]?.kind === "feature" && tree[0].status).toBe("failed");
    expect(tree[0]?.kind === "feature" && tree[0].children.map((child) => child.label)).toEqual([
      "Desktop",
      "Mobile",
    ]);
    expect(tree[1]?.kind === "feature" && tree[1].status).toBe("blocked");
  });

  it("uses viewport/name when id equals feature key", () => {
    const tree = buildContractTree([
      contract({
        id: "checkout",
        name: "Checkout Root",
        status: "passed",
        feature: "checkout",
        tags: ["desktop"],
      }),
    ]);
    expect(tree[0]?.kind === "feature" && tree[0].children[0]?.label).toBe("Desktop");
  });

  it("strips the full feature key prefix, not only the first dotted segment", () => {
    const tree = buildContractTree([
      contract({
        id: "127.0.0.1/3000/login.desktop",
        name: "Login Desktop",
        status: "passed",
        feature: "127.0.0.1/3000/login",
      }),
    ]);
    expect(tree[0]?.kind === "feature" && tree[0].children[0]?.label).toBe("Desktop");
  });

  it("finds selected leaf", () => {
    const tree = buildContractTree([
      contract({ id: "checkout.desktop", name: "Checkout", status: "passed", feature: "checkout" }),
    ]);
    expect(findContractTreeItem(tree, "checkout.desktop")?.id).toBe("contract:checkout.desktop");
    expect(findContractTreeItem(tree, undefined)).toBeUndefined();
  });
});
