import { describe, expect, it } from "vitest";

import { createRunId } from "../src/run-bundle/index.ts";

describe("createRunId", () => {
  it("never starts with a dash, so the id survives as a CLI argument", () => {
    for (let i = 0; i < 20_000; i++) expect(createRunId().startsWith("-")).toBe(false);
  });

  it("is a safe path segment and CLI value: alphanumeric only", () => {
    for (let i = 0; i < 1_000; i++) expect(createRunId()).toMatch(/^[0-9A-Za-z]{21}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => createRunId()));
    expect(ids.size).toBe(5_000);
  });
});
