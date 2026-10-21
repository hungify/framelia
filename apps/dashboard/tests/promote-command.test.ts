import type { DashboardContractResult } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import { promoteCommand, shellQuote } from "../lib/promote-command";

function pageContract(partial: Partial<DashboardContractResult> = {}): DashboardContractResult {
  return {
    id: "home.desktop",
    name: "Home",
    tags: [],
    status: "failed",
    phase: "complete",
    baselineKind: "page",
    actual: { path: "a.png", url: "http://127.0.0.1:3000/" },
    capture: { kind: "viewport", viewport: { width: 1440, height: 900 } },
    blockers: [],
    ...partial,
  };
}

describe("shellQuote", () => {
  it("leaves safe tokens alone and single-quotes the rest", () => {
    expect(shellQuote("home.desktop")).toBe("home.desktop");
    expect(shellQuote("http://127.0.0.1:3000/a?b=1&c")).toBe("'http://127.0.0.1:3000/a?b=1&c'");
    expect(shellQuote(`[data-x="it's"]`)).toBe(`'[data-x="it'"'"'s"]'`);
  });
});

describe("promoteCommand", () => {
  it("builds the CLI's kebab-case flags for a failed page-baseline contract", () => {
    expect(promoteCommand(pageContract({ sourceRunId: "run-7" }))).toBe(
      "framelia baseline promote --key home.desktop --target-url http://127.0.0.1:3000/ --viewport-width 1440 --viewport-height 900 --run-id run-7",
    );
  });

  it("prefers the authored contract id and carries a region selector", () => {
    const command = promoteCommand(
      pageContract({
        contractId: "home.hero",
        capture: {
          kind: "element",
          viewport: { width: 0, height: 0 },
          target: {
            definition: { kind: "css", value: ".hero" },
            matchCount: 1,
            stable: true,
          },
        },
      }),
    );
    expect(command).toBe(
      "framelia baseline promote --key home.hero --target-url http://127.0.0.1:3000/ --selector .hero",
    );
  });

  it("is only offered for failed page-baseline results with a target URL", () => {
    expect(promoteCommand(pageContract({ status: "passed" }))).toBeUndefined();
    expect(promoteCommand(pageContract({ baselineKind: "figma" }))).toBeUndefined();
    expect(promoteCommand(pageContract({ actual: undefined }))).toBeUndefined();
  });
});
