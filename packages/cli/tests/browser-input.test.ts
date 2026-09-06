import { describe, expect, it } from "vitest";

import {
  assertTargetUrl,
  targetUrlMessage,
  viewportPairMessage,
} from "../src/internal/browser-input.ts";

const WITH_STATE = { carriesBrowserStorageState: true };
const WITHOUT_STATE = { carriesBrowserStorageState: false };

describe("targetUrlMessage", () => {
  it("rejects anything that is not http(s)", () => {
    expect(targetUrlMessage("file:///tmp/x.html", "--target-url", WITHOUT_STATE)).toContain(
      "must use http:// or https://",
    );
  });

  it("allows plaintext http anywhere when no session is carried into the page", () => {
    expect(targetUrlMessage("http://staging.example.com/", "--target-url", WITHOUT_STATE)).toBe(
      undefined,
    );
  });

  it("allows https anywhere when a session is carried", () => {
    expect(targetUrlMessage("https://example.com/", "--target-url", WITH_STATE)).toBe(undefined);
  });

  it("blocks plaintext http to a routable host when a session is carried", () => {
    expect(targetUrlMessage("http://example.com/", "--target-url", WITH_STATE)).toContain(
      "must use https://",
    );
  });

  /**
   * The loopback allowance used to be a hand-kept hostname set that disagreed with the
   * dashboard's own set: an expanded IPv6 loopback was "local" when printing URLs but
   * "routable" here, so a legitimate target was rejected. Every spelling must agree.
   */
  it.each([
    "http://localhost:3000/login",
    "http://127.0.0.1:3000/login",
    "http://127.0.0.2:3000/login",
    "http://[::1]:3000/login",
    "http://[0:0:0:0:0:0:0:1]:3000/login",
    "http://[0000:0000:0000:0000:0000:0000:0000:0001]:3000/login",
  ])("allows plaintext http to loopback %s when a session is carried", (url) => {
    expect(targetUrlMessage(url, "--target-url", WITH_STATE)).toBe(undefined);
  });

  it("does not treat a routable host that merely starts with 'localhost' as loopback", () => {
    expect(targetUrlMessage("http://localhost.evil.com/", "--target-url", WITH_STATE)).toContain(
      "must use https://",
    );
  });
});

describe("assertTargetUrl", () => {
  it("throws a usage error carrying the label and the loopback rule", () => {
    expect(() => assertTargetUrl("http://example.com/", "--target-url", WITH_STATE)).toThrow(
      /--target-url must use https:\/\/ .*127\.0\.0\.0\/8/,
    );
  });

  it("stays silent for an allowed URL", () => {
    expect(() => assertTargetUrl("https://example.com/", "--target-url", WITH_STATE)).not.toThrow();
  });
});

describe("viewportPairMessage", () => {
  it("requires width and height together", () => {
    expect(viewportPairMessage(1280, undefined)).toContain("must be supplied together");
    expect(viewportPairMessage(undefined, 720)).toContain("must be supplied together");
  });

  it("accepts both set or both omitted", () => {
    expect(viewportPairMessage(1280, 720)).toBe(undefined);
    expect(viewportPairMessage(undefined, undefined)).toBe(undefined);
  });
});
