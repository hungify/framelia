import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertClientBuildExists,
  mountArtifactRoute,
  mountClientRoutes,
} from "../src/static-assets.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("assertClientBuildExists", () => {
  it("resolves when index.html is present", async () => {
    const clientRoot = await tempDir("framelia-static-client-");
    await fs.writeFile(path.join(clientRoot, "index.html"), "<main>Framelia</main>");
    await expect(assertClientBuildExists(clientRoot)).resolves.toBeUndefined();
  });

  it("throws a plain Error naming the missing build directory", async () => {
    const clientRoot = await tempDir("framelia-static-client-empty-");
    await expect(assertClientBuildExists(clientRoot)).rejects.toThrow(/Dashboard build missing/);
  });
});

describe("mountClientRoutes", () => {
  async function buildClientApp(): Promise<{ app: Hono; clientRoot: string }> {
    const clientRoot = await tempDir("framelia-static-client-");
    await fs.writeFile(path.join(clientRoot, "index.html"), "<main>Framelia</main>");
    await fs.writeFile(path.join(clientRoot, "app.js"), "console.log('hi')");
    const app = new Hono();
    mountClientRoutes(app, clientRoot);
    return { app, clientRoot };
  }

  it("serves a real file with the correct content-type from serveStatic's MIME table", async () => {
    const { app } = await buildClientApp();
    const response = await app.request("/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await response.text()).toContain("console.log");
  });

  it("falls back to index.html for an unknown client route (SPA fallback)", async () => {
    const { app } = await buildClientApp();
    const response = await app.request("/some/client/route");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Framelia");
  });

  it("serves index.html at the root path", async () => {
    const { app } = await buildClientApp();
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Framelia");
  });

  it("rejects an encoded path-traversal attempt instead of escaping clientRoot", async () => {
    const { app, clientRoot } = await buildClientApp();
    const secretDir = await tempDir("framelia-static-secret-");
    await fs.writeFile(path.join(secretDir, "secret.txt"), "top secret");
    const relative = path.relative(clientRoot, path.join(secretDir, "secret.txt"));
    const encodedTraversal = `/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;

    const response = await app.request(encodedTraversal);
    const body = await response.text();
    // Never returns the escaped file's contents -- serveStatic's traversal
    // guard makes it fall through to the SPA-fallback route instead.
    expect(body).not.toContain("top secret");
    expect(body).toContain("Framelia");
  });
});

function buildArtifactApp(fileMap: Map<string, string>): Hono {
  const app = new Hono();
  mountArtifactRoute(app, () => fileMap);
  return app;
}

describe("mountArtifactRoute", () => {
  it("serves an allowlisted file and rejects unknown paths", async () => {
    const evidenceDir = await tempDir("framelia-static-evidence-");
    const actualPath = path.join(evidenceDir, "actual.png");
    await fs.writeFile(actualPath, Buffer.from([1, 2, 3]));
    const app = buildArtifactApp(new Map([["contracts/home/actual.png", actualPath]]));

    const allowed = await app.request("/artifacts/contracts/home/actual.png");
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toBe("image/png");

    const rejected = await app.request("/artifacts/not-allowlisted.png");
    expect(rejected.status).toBe(404);
  });

  it("404s when the allowlisted path points at a file that no longer exists", async () => {
    const evidenceDir = await tempDir("framelia-static-evidence-");
    const missingPath = path.join(evidenceDir, "missing.png");
    const app = buildArtifactApp(new Map([["contracts/home/missing.png", missingPath]]));

    const response = await app.request("/artifacts/contracts/home/missing.png");
    expect(response.status).toBe(404);
  });

  it("documented exception: a .json artifact's content-type has no charset suffix", async () => {
    const evidenceDir = await tempDir("framelia-static-evidence-");
    const scorePath = path.join(evidenceDir, "score.json");
    await fs.writeFile(scorePath, JSON.stringify({ ok: true }));
    const app = buildArtifactApp(new Map([["contracts/home/score.json", scorePath]]));

    const response = await app.request("/artifacts/contracts/home/score.json");
    expect(response.status).toBe(200);
    // Hono's MIME table maps .json -> "application/json" with no charset
    // suffix (unlike .css/.html/.js, which do carry one). Both real
    // consumers parse this body via .json()/JSON.parse, which is
    // charset-agnostic for UTF-8. Pinned here so a future MIME-table change
    // would be caught rather than silently drifting.
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });
});
