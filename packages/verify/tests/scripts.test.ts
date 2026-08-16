import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { makeSolidPng, writePng } from "../src/internal.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-scripts-"));
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function runScript(name: string, args: string[]) {
  return spawnSync(process.execPath, [tsxCli, path.join(packageRoot, "scripts", name), ...args], {
    encoding: "utf8",
  });
}

describe("debug script argument validation", () => {
  it("rejects invalid Figma image scale before network access", () => {
    const result = runScript("fetch-gold.ts", [
      "file",
      "1:2",
      path.join(tmp, "gold.png"),
      "Infinity",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Invalid scale");
  });

  it("rejects crop rectangles outside source bounds", () => {
    const source = path.join(tmp, "source.png");
    const output = path.join(tmp, "crop.png");
    writePng(source, makeSolidPng(10, 10, [255, 255, 255, 255]));
    const result = runScript("crop.ts", [source, output, "9", "9", "2", "2"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Invalid crop rectangle");
    expect(fs.existsSync(output)).toBe(false);
  });
});
