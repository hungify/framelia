import { describe, expect, it } from "vitest";

import { CONTRACT_ID_PATTERN, FIGMA_NODE_ID, SCHEMA_VERSION } from "../src/constants.ts";

describe("SCHEMA_VERSION", () => {
  it("is the current hard-pinned schema version", () => {
    expect(SCHEMA_VERSION).toBe(5);
  });
});

describe("CONTRACT_ID_PATTERN", () => {
  it("accepts a single lowercase-alnum segment", () => {
    expect(CONTRACT_ID_PATTERN.test("home")).toBe(true);
  });

  it("accepts dot- and hyphen-delimited segments", () => {
    expect(CONTRACT_ID_PATTERN.test("home.hero-section")).toBe(true);
  });

  it("accepts digits", () => {
    expect(CONTRACT_ID_PATTERN.test("page2")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(CONTRACT_ID_PATTERN.test("Home")).toBe(false);
  });

  it("rejects a leading separator", () => {
    expect(CONTRACT_ID_PATTERN.test(".home")).toBe(false);
  });

  it("rejects a trailing separator", () => {
    expect(CONTRACT_ID_PATTERN.test("home.")).toBe(false);
  });

  it("rejects a doubled separator", () => {
    expect(CONTRACT_ID_PATTERN.test("home..hero")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(CONTRACT_ID_PATTERN.test("home hero")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(CONTRACT_ID_PATTERN.test("")).toBe(false);
  });
});

describe("FIGMA_NODE_ID", () => {
  it("accepts a plain node id", () => {
    expect(FIGMA_NODE_ID.test("123:45")).toBe(true);
  });

  it("accepts an instance-swapped node id", () => {
    expect(FIGMA_NODE_ID.test("I123:45;67:89")).toBe(true);
  });

  it("accepts an instance-swapped node id with multiple swap segments", () => {
    expect(FIGMA_NODE_ID.test("I123:45;67:89;10:11")).toBe(true);
  });

  it("rejects a plain node id missing the colon", () => {
    expect(FIGMA_NODE_ID.test("12345")).toBe(false);
  });

  it("rejects an instance-swapped id with no swap segment after the prefix", () => {
    expect(FIGMA_NODE_ID.test("I123:45")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(FIGMA_NODE_ID.test("")).toBe(false);
  });
});
