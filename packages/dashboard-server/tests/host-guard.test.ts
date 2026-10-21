import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { hostGuard, noSniff } from "../src/host-guard.ts";

function guardedApp(hostname: string, port = 6789): Hono {
  const app = new Hono();
  app.use("*", noSniff);
  app.use("*", hostGuard({ hostname, port: () => port }));
  app.get("/api/run", (context) => context.json({ ok: true }));
  return app;
}

async function status(app: Hono, headers: Record<string, string>): Promise<number> {
  return (await app.request("http://ignored/api/run", { headers })).status;
}

describe("hostGuard", () => {
  it("accepts loopback names and literals on the bound port", async () => {
    const app = guardedApp("localhost");
    const hosts = ["localhost:6789", "127.0.0.1:6789", "[::1]:6789", "LOCALHOST:6789"];
    const statuses = await Promise.all(hosts.map((host) => status(app, { host })));
    expect(statuses).toEqual([200, 200, 200, 200]);
  });

  it("accepts the configured loopback hostname", async () => {
    expect(await status(guardedApp("127.0.0.2"), { host: "127.0.0.2:6789" })).toBe(200);
    expect(await status(guardedApp("::1"), { host: "[::1]:6789" })).toBe(200);
  });

  it("rejects a rebound DNS name, a wrong port, and a missing/malformed Host", async () => {
    const app = guardedApp("localhost");
    expect(await status(app, { host: "attacker.example:6789" })).toBe(403);
    expect(await status(app, { host: "localhost:1234" })).toBe(403);
    expect(await status(app, { host: "localhost" })).toBe(403);
    expect(await status(app, { host: "local host:6789" })).toBe(403);
    expect(await status(app, {})).toBe(403);
  });

  it("rejects a cross-site Origin but allows a loopback one on any port", async () => {
    const app = guardedApp("localhost");
    const host = "localhost:6789";
    expect(await status(app, { host, origin: "https://attacker.example" })).toBe(403);
    expect(await status(app, { host, origin: "null" })).toBe(403);
    expect(await status(app, { host, origin: "http://localhost:5173" })).toBe(200);
    expect(await status(app, { host, origin: "http://127.0.0.1:6789" })).toBe(200);
  });

  it("stands aside for an explicit non-loopback bind", async () => {
    const app = guardedApp("0.0.0.0");
    expect(await status(app, { host: "dev-box.lan:6789" })).toBe(200);
  });
});

describe("noSniff", () => {
  it("adds X-Content-Type-Options to allowed and rejected responses", async () => {
    const app = guardedApp("localhost");
    const allowed = await app.request("http://ignored/api/run", {
      headers: { host: "localhost:6789" },
    });
    expect(allowed.headers.get("x-content-type-options")).toBe("nosniff");
    const rejected = await app.request("http://ignored/api/run", {
      headers: { host: "evil:6789" },
    });
    expect(rejected.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
