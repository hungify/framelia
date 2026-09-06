import { describe, expect, it } from "vitest";

import { isLoopbackHostname, isWildcardHostname } from "../src/host.ts";

describe("isLoopbackHostname", () => {
  it("accepts the three spellings every caller already knew about", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
  });

  it("accepts every expansion of the IPv6 loopback, not just the canonical one", () => {
    expect(isLoopbackHostname("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackHostname("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(isLoopbackHostname("::0001")).toBe(true);
  });

  it("accepts the rest of 127.0.0.0/8, which a hostname set could never enumerate", () => {
    expect(isLoopbackHostname("127.0.0.2")).toBe(true);
    expect(isLoopbackHostname("127.1.2.3")).toBe(true);
    expect(isLoopbackHostname("127.255.255.255")).toBe(true);
  });

  it("accepts a bracketed IPv6 host, as WHATWG's URL.hostname yields it", () => {
    expect(isLoopbackHostname(new URL("http://[::1]:3000/").hostname)).toBe(true);
  });

  it("rejects routable and near-miss hosts", () => {
    expect(isLoopbackHostname("192.168.1.5")).toBe(false);
    expect(isLoopbackHostname("128.0.0.1")).toBe(false);
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isLoopbackHostname("localhost.evil.com")).toBe(false);
    expect(isLoopbackHostname("::2")).toBe(false);
    expect(isLoopbackHostname("127.0.0.256")).toBe(false);
  });
});

describe("isWildcardHostname", () => {
  it("accepts every spelling of bind-all", () => {
    expect(isWildcardHostname("0.0.0.0")).toBe(true);
    expect(isWildcardHostname("::")).toBe(true);
    expect(isWildcardHostname("0000:0000:0000:0000:0000:0000:0000:0000")).toBe(true);
  });

  it("does not confuse bind-all with loopback", () => {
    expect(isWildcardHostname("127.0.0.1")).toBe(false);
    expect(isWildcardHostname("::1")).toBe(false);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
  });
});
