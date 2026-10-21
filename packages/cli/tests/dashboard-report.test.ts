import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { runRecordPath } from "@framelia/verify/run-bundle";
import { afterEach, describe, expect, it } from "vitest";

import {
  DASHBOARD_RUN_FILE,
  exportDashboardReport,
  selectedDashboardSource,
} from "../src/dashboard/report.ts";
import { reportCommand } from "../src/internal/dashboard-report.ts";
import { createSelectedRun } from "./selected-run-fixture.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

async function clientFixture(): Promise<string> {
  const root = await temporaryRoot("framelia-client-");
  await fs.writeFile(path.join(root, "index.html"), "<main id=app>dashboard</main>");
  return root;
}

describe("selected run dashboard report", () => {
  it("exports the exact live projection and keeps evidence portable after deleting the writer root", async () => {
    const writerRoot = await temporaryRoot("framelia-writer-");
    await createSelectedRun(writerRoot, {
      runId: "run-relocated",
      attempts: [false, true],
      portableSentinel: path.join(writerRoot, "private", "capture.log"),
    });
    const reportRoot = await temporaryRoot("framelia-report-parent-");
    const outputDirectory = path.join(reportRoot, "report");

    const live = await selectedDashboardSource(writerRoot, "run-relocated").snapshot();
    await exportDashboardReport({
      projectRoot: writerRoot,
      runId: "run-relocated",
      outputDirectory,
      clientRoot: await clientFixture(),
    });
    const archived = JSON.parse(
      await fs.readFile(path.join(outputDirectory, "data", DASHBOARD_RUN_FILE), "utf8"),
    );
    expect(archived).toEqual(live);
    expect(archived.runId).toBe("run-relocated");
    expect(archived.contracts[0].attempts).toHaveLength(2);
    expect(archived.contracts[0].sourceRunId).toBe("run-relocated");

    const portablePaths = archived.contracts[0].attempts.flatMap(
      (attempt: { evidence: Record<string, { path?: string }> }) =>
        Object.values(attempt.evidence).flatMap((evidence) =>
          evidence.path ? [evidence.path] : [],
        ),
    );
    expect(portablePaths.every((entry: string) => entry.includes(".framelia/runs/"))).toBe(true);
    expect(portablePaths.every((entry: string) => entry.includes("attempts/"))).toBe(true);
    const reportFiles = await fs.readdir(outputDirectory, { recursive: true });
    for (const reportFile of reportFiles) {
      if (typeof reportFile !== "string" || !reportFile.endsWith(".json")) continue;
      const serialized = await fs.readFile(path.join(outputDirectory, reportFile), "utf8");
      expect(serialized).not.toContain(writerRoot);
    }
    expect(archived.contracts[0].attempts[0].warnings[0]).toContain(
      "<project-root>/private/capture.log",
    );

    await fs.rm(writerRoot, { recursive: true, force: true });
    for (const portablePath of portablePaths) {
      await expect(
        fs.access(path.join(outputDirectory, "data", portablePath)),
      ).resolves.toBeUndefined();
    }
  });

  it("serves snapshot() and files() from one projection until the run changes", async () => {
    const root = await temporaryRoot("framelia-source-cache-");
    await createSelectedRun(root, { runId: "run-cached", attempts: [false, true] });
    const source = selectedDashboardSource(root, "run-cached");

    const snapshot = await source.snapshot();
    const files = await source.files();
    expect(await source.snapshot()).toBe(snapshot);
    expect(await source.files()).toBe(files);
    expect(files.size).toBeGreaterThan(0);

    // A rewritten run record (e.g. a re-seal) is a change: the next call re-projects it.
    const recordPath = runRecordPath(root, "run-cached");
    const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
    await fs.writeFile(
      recordPath,
      `${JSON.stringify({ ...record, finalizedAt: "2026-09-15T00:00:20.000Z" }, null, 2)}\n`,
    );
    const refreshed = await source.snapshot();
    expect(refreshed).not.toBe(snapshot);
    expect(refreshed.finishedAt).toBe("2026-09-15T00:00:20.000Z");
  });

  it("report command requires an explicit run and returns that identity", async () => {
    const root = await temporaryRoot("framelia-report-command-");
    await createSelectedRun(root, { runId: "run-command" });
    const output = path.join(root, "portable-report");
    const runtime = {
      cwd: () => root,
      env: {},
      stdout: { write: () => true },
      stderr: { write: () => true },
    } as never;
    const result = await reportCommand(
      { projectRoot: root, run: "run-command", output },
      { process: runtime },
      { clientRoot: await clientFixture() },
    );
    expect(result.body).toMatchObject({
      kind: "framelia.report-outcome",
      command: "report",
      runId: "run-command",
      bundlePath: expect.stringMatching(/^\.framelia\/runs\/run-command-/),
      executionState: "completed",
      selection: {
        mode: "all",
        selectedCount: 1,
        fullRequiredCount: 1,
      },
      cases: [
        expect.objectContaining({
          contractId: "login.desktop",
          chosenAttemptId: expect.any(String),
          attempts: [expect.objectContaining({ chosen: true })],
        }),
      ],
    });
    await expect(fs.access(path.join(output, "index.html"))).resolves.toBeUndefined();

    const missing = await reportCommand(
      { projectRoot: root, run: undefined, output: undefined },
      { process: runtime },
    );
    expect(missing).toMatchObject({
      exitCode: 2,
      body: {
        kind: "framelia.report-outcome",
        executionState: "error",
        diagnostics: [{ code: "REPORT_FAILED", message: expect.stringContaining("requires") }],
      },
    });
  });
});

describe("report replacement", () => {
  it("replaces a previous report only after the new one is complete", async () => {
    const root = await temporaryRoot("framelia-report-swap-");
    await createSelectedRun(root, { runId: "run-swap" });
    const outputDirectory = path.join(root, "report");
    const clientRoot = await clientFixture();
    await exportDashboardReport({
      projectRoot: root,
      runId: "run-swap",
      outputDirectory,
      clientRoot,
    });
    const previousIndex = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");

    await expect(
      exportDashboardReport({
        projectRoot: root,
        runId: "run-swap",
        outputDirectory,
        clientRoot: path.join(root, "missing-client"),
      }),
    ).rejects.toThrow(/ENOENT/);
    await expect(fs.readFile(path.join(outputDirectory, "index.html"), "utf8")).resolves.toBe(
      previousIndex,
    );
    expect((await fs.readdir(root)).filter((name) => name.includes("framelia-staging"))).toEqual(
      [],
    );

    await fs.writeFile(path.join(clientRoot, "index.html"), "<main>v2</main>");
    await exportDashboardReport({
      projectRoot: root,
      runId: "run-swap",
      outputDirectory,
      clientRoot,
    });
    await expect(fs.readFile(path.join(outputDirectory, "index.html"), "utf8")).resolves.toBe(
      "<main>v2</main>",
    );
    expect((await fs.readdir(root)).filter((name) => name.includes("framelia-staging"))).toEqual(
      [],
    );
  });
});
