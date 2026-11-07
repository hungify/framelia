import { describe, expect, it } from "vitest";

import { filterQuery } from "../composables/useRunDashboard";

describe("filterQuery", () => {
  it("writes search and a non-default status, keeping unrelated keys", () => {
    expect(filterQuery({ other: "1" }, "checkout", "failed")).toEqual({
      other: "1",
      q: "checkout",
      status: "failed",
    });
  });

  it("omits an empty search and the default status", () => {
    expect(filterQuery({ q: "old", status: "failed" }, "", "all")).toEqual({});
  });
});
