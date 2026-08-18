import { describe, expect, it } from "vitest";

import { DuplicateFlagError, rejectDuplicateFlags, type FlagSpec } from "../src/argv-flags.ts";

const FLAGS: FlagSpec[] = [
  { flag: "--project-root", takesValue: true },
  { flag: "--force", takesValue: false },
];

describe("rejectDuplicateFlags", () => {
  it("allows each known flag to appear once", () => {
    expect(() =>
      rejectDuplicateFlags(["--project-root", "/tmp/proj", "--force"], FLAGS),
    ).not.toThrow();
  });

  it("throws DuplicateFlagError when a value flag repeats", () => {
    expect(() =>
      rejectDuplicateFlags(["--project-root", "/a", "--project-root", "/b"], FLAGS),
    ).toThrow(DuplicateFlagError);
  });

  it("throws DuplicateFlagError when a boolean flag repeats", () => {
    expect(() => rejectDuplicateFlags(["--force", "--force"], FLAGS)).toThrow(DuplicateFlagError);
  });

  it("detects a duplicate expressed as --flag=value", () => {
    expect(() => rejectDuplicateFlags(["--project-root=/a", "--project-root=/b"], FLAGS)).toThrow(
      DuplicateFlagError,
    );
  });

  it("ignores flags outside the known set", () => {
    expect(() => rejectDuplicateFlags(["--unknown", "--unknown"], FLAGS)).not.toThrow();
  });

  it("swallows a value-taking flag's next token even if it looks like a flag", () => {
    // --project-root consumes the first --force as its value, leaving only one real --force.
    expect(() =>
      rejectDuplicateFlags(["--project-root", "--force", "--force"], FLAGS),
    ).not.toThrow();
  });
});
