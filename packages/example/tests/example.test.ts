import { describe, expect, it } from "vitest";

import { toContractId } from "../src/index.ts";

describe("toContractId", () => {
  it("joins slugged names with dots", () => {
    expect(toContractId("Checkout Page", "Desktop")).toBe("checkout-page.desktop");
  });

  it("drops names that slug to nothing", () => {
    expect(toContractId("Login", "  ", "!!!")).toBe("login");
  });
});
