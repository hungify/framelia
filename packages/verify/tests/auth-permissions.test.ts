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

describe.runIf(process.platform !== "win32")("Playwright auth state permissions", () => {
  it("writes the session owner-only (0600) inside an owner-only (0700) new directory", async () => {
    const server = http.createServer((_request, response) => {
      response.setHeader("Set-Cookie", "session=test-session; Path=/; HttpOnly");
      response.end("logged in");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Test server did not expose a TCP port.");
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-auth-mode-"));
      temporaryDirectories.push(directory);
      const outputPath = path.join(directory, ".framelia", "auth", "user.json");

      await recordStorageState({
        url: `http://127.0.0.1:${address.port}/login`,
        outputPath,
        waitForUser: async () => undefined,
        headless: true,
      });

      expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(outputPath)).mode & 0o777).toBe(0o700);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
