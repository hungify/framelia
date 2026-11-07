import { describe, expect, it } from "vitest";

import { resolveRunIdentity } from "../src/run-identity.ts";

const newId = (): string => "generated";

describe("resolveRunIdentity", () => {
  it("generates an ID for an unsharded run without an explicit one", () => {
    expect(resolveRunIdentity({ newId })).toEqual({ runId: "generated", perShardBundle: false });
  });

  it("prefers the reporter option over the environment", () => {
    const identity = resolveRunIdentity({ optionRunId: "option", envRunId: "env", newId });
    expect(identity.runId).toBe("option");
  });

  it("falls back to the trimmed environment value and ignores a blank one", () => {
    expect(resolveRunIdentity({ envRunId: "  env-1  ", newId }).runId).toBe("env-1");
    expect(resolveRunIdentity({ envRunId: "   ", newId }).runId).toBe("generated");
  });

  it("trims whitespace around the reporter option", () => {
    expect(resolveRunIdentity({ optionRunId: "  ci-7  ", newId }).runId).toBe("ci-7");
  });

  it("treats a blank reporter option as unset and falls back to the environment, then a fresh ID", () => {
    expect(resolveRunIdentity({ optionRunId: "   ", envRunId: "env-1", newId }).runId).toBe(
      "env-1",
    );
    expect(resolveRunIdentity({ optionRunId: "", envRunId: "env-1", newId }).runId).toBe("env-1");
    expect(resolveRunIdentity({ optionRunId: "   ", newId })).toEqual({
      runId: "generated",
      perShardBundle: false,
    });
    expect(resolveRunIdentity({ optionRunId: "", newId }).runId).toBe("generated");
  });

  it("gives a shard with a blank reporter option and no environment value its own suffixed bundle", () => {
    expect(
      resolveRunIdentity({ optionRunId: "   ", shard: { current: 1, total: 2 }, newId }),
    ).toEqual({
      runId: "generated-shard-1-of-2",
      perShardBundle: true,
    });
  });

  it("lets every shard share an explicit run ID", () => {
    expect(
      resolveRunIdentity({ optionRunId: "ci-7", shard: { current: 2, total: 3 }, newId }),
    ).toEqual({
      runId: "ci-7",
      sharedShard: { current: 2, total: 3 },
      perShardBundle: false,
    });
  });

  it("gives a shard without a shared run ID its own suffixed bundle", () => {
    expect(resolveRunIdentity({ shard: { current: 1, total: 2 }, newId })).toEqual({
      runId: "generated-shard-1-of-2",
      perShardBundle: true,
    });
  });

  it("rejects a reporter option that starts with a dash, naming the value", () => {
    const resolve = (): unknown => resolveRunIdentity({ optionRunId: "-ci-7", newId });
    expect(resolve).toThrow(/-ci-7/);
    expect(resolve).toThrow(/must not start with ["'`]?-/i);
  });

  it("rejects a FRAMELIA_RUN_ID that starts with a dash, naming the variable and the value", () => {
    const resolve = (): unknown => resolveRunIdentity({ envRunId: "-ci-7", newId });
    expect(resolve).toThrow(/FRAMELIA_RUN_ID/);
    expect(resolve).toThrow(/-ci-7/);
    expect(resolve).toThrow(/must not start with ["'`]?-/i);
  });

  it("rejects a dash that follows leading whitespace once the value is trimmed", () => {
    expect(() => resolveRunIdentity({ optionRunId: "  -x", newId })).toThrow(
      /must not start with ["'`]?-/i,
    );
    expect(() => resolveRunIdentity({ envRunId: "  -x", newId })).toThrow(
      /must not start with ["'`]?-/i,
    );
  });

  it("treats a null shard as an unsharded run", () => {
    expect(resolveRunIdentity({ optionRunId: "run", shard: null, newId })).toEqual({
      runId: "run",
      perShardBundle: false,
    });
  });
});
