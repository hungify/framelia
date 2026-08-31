import type { UIContractResult } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import {
  buildContractTree,
  filterContracts,
  findContractTreeItem,
  resolveSelectedContract,
} from "../lib/contract-tree";

function contract(
  partial: Partial<UIContractResult> & Pick<UIContractResult, "id" | "name" | "status">,
): UIContractResult {
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

  it("prefers matching id then falls back to first", () => {
    expect(resolveSelectedContract(items, "b")?.id).toBe("b");
    expect(resolveSelectedContract(items, "missing")?.id).toBe("a");
    expect(resolveSelectedContract([], "a")).toBeUndefined();
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
