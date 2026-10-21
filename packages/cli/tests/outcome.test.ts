import { AppError } from "@framelia/verify";
import { describe, expect, it } from "vitest";

import { failureDiagnostic, frameliaNext, runExitCode } from "../src/internal/outcome.ts";

describe("runExitCode", () => {
  it.each([
    [true, "passed", 0],
    [true, "mismatched", 1],
    [true, "not-evaluated", 0],
    [false, "passed", 2],
    [false, "mismatched", 2],
    [false, "not-evaluated", 2],
  ] as const)("completed=%s verdict=%s exits %s", (completed, verdict, exitCode) => {
    expect(runExitCode(completed, verdict)).toBe(exitCode);
  });
});

describe("failureDiagnostic", () => {
  it("keeps an AppError code and falls back otherwise", () => {
    expect(failureDiagnostic(new AppError("AUTHORING_CONFLICT", "moved"), "X", "s")).toEqual({
      code: "AUTHORING_CONFLICT",
      stage: "s",
      message: "moved",
    });
    expect(failureDiagnostic("boom", "X_FAILED", "s")).toEqual({
      code: "X_FAILED",
      stage: "s",
      message: "boom",
    });
  });
});

describe("frameliaNext", () => {
  it("appends --project-root only when one was given", () => {
    expect(frameliaNext(["contract", "list"], undefined)).toEqual({
      command: "framelia",
      argv: ["contract", "list"],
    });
    expect(frameliaNext(["contract", "list"], "app")).toEqual({
      command: "framelia",
      argv: ["contract", "list", "--project-root", "app"],
    });
  });
});
