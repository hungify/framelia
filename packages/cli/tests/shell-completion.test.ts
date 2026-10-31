import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const framelia = path.join(packageRoot, "bin", "framelia.js");
const bashComplete = path.join(packageRoot, "bin", "__framelia_bash_complete.js");

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/** What bash runs for `framelia <line>`: the words after the command name, plus COMP_LINE. */
function complete(line: string): string[] {
  const words = line.split(" ").filter(Boolean).slice(1);
  const result = spawnSync(process.execPath, [bashComplete, "framelia", ...words], {
    encoding: "utf8",
    env: { ...process.env, COMP_LINE: line },
  });
  expect(result.status).toBe(0);
  return result.stdout.split("\n").filter(Boolean);
}

function homeWithBashrc(content: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-completion-"));
  temporaryDirectories.push(home);
  fs.writeFileSync(path.join(home, ".bashrc"), content);
  return home;
}

function runFramelia(args: string[], home: string) {
  return spawnSync(process.execPath, [framelia, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, SHELL: "/bin/bash" },
  });
}

describe("bash completion proposals", () => {
  it("completes a partial top-level command", () => {
    expect(complete("framelia con")).toEqual(["contract"]);
  });

  it("lists the subcommands of a route after a trailing space", () => {
    expect(complete("framelia contract ")).toEqual(
      expect.arrayContaining(["create", "list", "refresh-baseline", "suggest-masks"]),
    );
  });

  it("completes a flag of the typed command", () => {
    expect(complete("framelia dashboard --ru")).toContain("--run");
  });
});

describe("framelia completion install", () => {
  it("adds a bash completion hook to ~/.bashrc that calls the completion bin", () => {
    const home = homeWithBashrc("export KEEP=1\n");

    const result = runFramelia(["completion", "install"], home);

    expect(result.status).toBe(0);
    const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
    expect(bashrc).toContain("export KEEP=1");
    expect(bashrc).toContain("complete -o default -o nospace -F __framelia_complete framelia");
    expect(bashrc).toContain("__framelia_bash_complete");
  });

  it("installs once even when run twice", () => {
    const home = homeWithBashrc("");

    runFramelia(["completion", "install"], home);
    runFramelia(["completion", "install"], home);

    const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
    expect(bashrc.match(/-F __framelia_complete framelia/g)).toHaveLength(1);
  });

  it("removes only its own block on uninstall", () => {
    const home = homeWithBashrc("export KEEP=1\n");
    runFramelia(["completion", "install"], home);

    const result = runFramelia(["completion", "uninstall"], home);

    expect(result.status).toBe(0);
    const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
    expect(bashrc).toContain("export KEEP=1");
    expect(bashrc).not.toContain("__framelia_complete");
  });
});
