import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runBashComplete } from "../src/bash-complete.ts";
import { BASH_COMPLETION_COMMAND } from "../src/cli-constants.ts";
import { run } from "../src/cli.ts";
import {
  completionInstallCommand,
  completionUninstallCommand,
} from "../src/internal/completion.ts";
import { createFakeProcess } from "./fake-process.ts";
import { testEnvironment } from "./test-environment.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

const START_MARKER = "# @stricli/auto-complete START [framelia]";

/** A temporary HOME; `bashrc: null` leaves it without a ~/.bashrc. */
function tempHome(bashrc: string | null = "export FOO=1\n"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-completion-home-"));
  homes.push(directory);
  if (bashrc !== null) fs.writeFileSync(path.join(directory, ".bashrc"), bashrc);
  return directory;
}

function bashEnvironment(homeDirectory: string, shell = "/bin/bash") {
  return testEnvironment(createFakeProcess({ HOME: homeDirectory, SHELL: shell }));
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("completion install/uninstall", () => {
  it("installs the bash block once into ~/.bashrc, keeping existing lines", async () => {
    const homeDirectory = tempHome();
    const bashrc = path.join(homeDirectory, ".bashrc");

    const first = await completionInstallCommand({ shell: "bash" }, bashEnvironment(homeDirectory));
    const second = await completionInstallCommand(
      { shell: "bash" },
      bashEnvironment(homeDirectory),
    );

    expect(first).toMatchObject({
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: 1,
        kind: "framelia.completion-outcome",
        command: "completion install",
        executionState: "completed",
        shell: "bash",
        profilePath: bashrc,
        changed: true,
        proposalCommand: BASH_COMPLETION_COMMAND,
        diagnostics: [],
      },
    });
    expect(second.body).toMatchObject({ changed: false });
    const contents = fs.readFileSync(bashrc, "utf8");
    expect(contents.startsWith("export FOO=1\n")).toBe(true);
    expect(occurrences(contents, START_MARKER)).toBe(1);
    expect(contents).toContain(`$(${BASH_COMPLETION_COMMAND} $COMP_LINE)`);
    expect(contents).toContain("complete -o default -o nospace -F __framelia_complete framelia");
  });

  it("uninstall removes exactly the installed block and reports a no-op afterwards", async () => {
    const homeDirectory = tempHome();
    const bashrc = path.join(homeDirectory, ".bashrc");
    await completionInstallCommand({ shell: "bash" }, bashEnvironment(homeDirectory));

    const removed = await completionUninstallCommand(
      { shell: "bash" },
      bashEnvironment(homeDirectory),
    );
    const again = await completionUninstallCommand(
      { shell: "bash" },
      bashEnvironment(homeDirectory),
    );

    expect(removed).toMatchObject({
      ok: true,
      body: { command: "completion uninstall", changed: true },
    });
    expect(again.body).toMatchObject({ changed: false });
    expect(fs.readFileSync(bashrc, "utf8")).toBe("export FOO=1\n");
  });

  it("refuses with a structured failure when $SHELL is not bash, leaving the profile alone", async () => {
    const homeDirectory = tempHome();

    const result = await completionInstallCommand(
      { shell: "bash" },
      bashEnvironment(homeDirectory, "/bin/zsh"),
    );

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      body: {
        kind: "framelia.completion-outcome",
        command: "completion install",
        executionState: "error",
        exitCode: 2,
        diagnostics: [{ code: "COMPLETION_SHELL_NOT_DETECTED", stage: "completion" }],
      },
    });
    expect(fs.readFileSync(path.join(homeDirectory, ".bashrc"), "utf8")).toBe("export FOO=1\n");
  });

  it("refuses with a structured failure when ~/.bashrc does not exist, creating nothing", async () => {
    const homeDirectory = tempHome(null);

    const result = await completionUninstallCommand(
      { shell: "bash" },
      bashEnvironment(homeDirectory),
    );

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      body: { diagnostics: [{ code: "COMPLETION_PROFILE_MISSING" }] },
    });
    expect(fs.existsSync(path.join(homeDirectory, ".bashrc"))).toBe(false);
  });
});

describe("completion routes", () => {
  it("`framelia completion install` prints one JSON outcome and exits 0", async () => {
    const homeDirectory = tempHome();
    const fakeProcess = createFakeProcess({ HOME: homeDirectory, SHELL: "/usr/bin/bash" });

    await run(["completion", "install"], { process: fakeProcess, loadProjectEnv: false });

    expect(fakeProcess.exitCode).toBe(0);
    expect(fakeProcess.stderrText()).toBe("");
    expect(JSON.parse(fakeProcess.stdoutText())).toMatchObject({
      kind: "framelia.completion-outcome",
      command: "completion install",
      changed: true,
    });
  });

  it("never loads the project's .env (it must not steer HOME or SHELL)", async () => {
    const cwd = tempHome();
    const homeDirectory = tempHome();
    fs.writeFileSync(path.join(cwd, ".env"), "FRAMELIA_COMPLETION_ENV_MARKER=from-dotenv\n");
    const runtime = {
      ...createFakeProcess({ HOME: homeDirectory, SHELL: "/bin/bash" }),
      cwd: () => cwd,
    };

    await run(["completion", "uninstall"], { process: runtime });

    expect(runtime.env.FRAMELIA_COMPLETION_ENV_MARKER).toBeUndefined();
    expect(runtime.exitCode).toBe(0);
  });
});

/** What `__framelia_bash_complete $COMP_LINE` prints, one proposal per line. */
async function propose(compLine: string): Promise<string[]> {
  const fakeProcess = createFakeProcess({ COMP_LINE: compLine });
  // Bash word-splits the unquoted $COMP_LINE and drops the trailing empty word.
  await runBashComplete(compLine.split(" ").filter(Boolean), { process: fakeProcess });
  expect(fakeProcess.stderrText()).toBe("");
  return fakeProcess.stdoutText().split("\n").filter(Boolean);
}

describe("__framelia_bash_complete", () => {
  it("proposes root routes for the first word despite the dashboard default command", async () => {
    expect(await propose("framelia co")).toEqual(["contract", "compare", "completion"]);
    expect(await propose("framelia ")).toEqual(expect.arrayContaining(["check", "runs", "init"]));
  });

  it("proposes nested routes, flags and enum values", async () => {
    expect(await propose("framelia completion ")).toEqual(["install", "uninstall"]);
    expect(await propose("framelia runs prune --k")).toEqual(["--keep"]);
    expect(await propose("framelia schema --target r")).toEqual(["requirements"]);
  });

  it("prints nothing for unknown input instead of failing the shell", async () => {
    expect(await propose("framelia not-a-route --x")).toEqual([]);
  });
});
