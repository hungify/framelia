import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordStorageState } from "../src/auth.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Playwright auth state", () => {
  it("records browser cookies without exposing credentials to caller", async () => {
    const server = http.createServer((_request, response) => {
      response.setHeader("Set-Cookie", "session=test-session; Path=/; HttpOnly; SameSite=Lax");
      response.end("logged in");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Test server did not expose a TCP port.");
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-auth-"));
      temporaryDirectories.push(directory);
      const outputPath = path.join(directory, ".framelia", "auth", "user.json");

      const result = await recordStorageState({
        url: `http://127.0.0.1:${address.port}/login`,
        outputPath,
        waitForUser: async () => undefined,
        headless: true,
      });
      const state = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
        cookies: Array<{ name: string; value: string }>;
      };

      expect(result.outputPath).toBe(outputPath);
      expect(result.finalUrl).toContain("/login");
      expect(state.cookies).toContainEqual(
        expect.objectContaining({ name: "session", value: "test-session" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
