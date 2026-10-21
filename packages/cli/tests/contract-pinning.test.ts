import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FetchBaselineFn } from "@framelia/verify";
import { afterEach, describe, expect, it } from "vitest";

import { contractCreateCommand } from "../src/internal/contract-create.ts";
import { openContractPinning, type ContractPinning } from "../src/internal/contract-pinning.ts";
import { openProject } from "../src/internal/project.ts";
import { nonInteractivePrompts } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const PNG_10_BY_10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAH0lEQVR4nOTJQQ0AAAwCMbLMv+VDARig3z6g7FSttgEAAP//iF8rAQAAAAZJREFUAwCphQMUUAhjNAAAAABJRU5ErkJggg==",
  "base64",
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function runtime(root: string): CliRuntime {
  return {
    cwd: () => root,
    env: {},
    stdin: process.stdin,
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
    exitCode: undefined,
  };
}

function fakeFetch(onFetch?: () => void): FetchBaselineFn {
  return async (options) => {
    onFetch?.();
    fs.writeFileSync(options.outPath, PNG_10_BY_10);
    const meta = {
      nodeId: options.nodeId,
      fileKey: options.fileKey,
      lastModified: null,
      fetchedAt: "2026-09-22T00:00:00.000Z",
      apiCallCount: 0,
      apiCallLog: [],
    };
    const metaPath = `${options.outPath}.meta.json`;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    return {
      ok: true,
      fetched: true,
      baselinePath: options.outPath,
      metaPath,
      meta,
      warnings: [],
      figmaStyle: {},
    };
  };
}

/** A project holding one authored contract, `account.profile`, created through the CLI. */
async function projectWithContract(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-pinning-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "framelia.config.mjs"),
    'export default { contracts: [".framelia/contracts/**/visual-contract.json"] };\n',
  );
  const created = await contractCreateCommand(
    {
      projectRoot: root,
      output: undefined,
      force: undefined,
      targetPath: "/account",
      targetUrl: undefined,
      contractId: "account.profile",
      name: "Account profile",
      figmaUrl: "https://www.figma.com/design/file-key/Profile?node-id=6006-1028",
      fileKey: undefined,
      nodeId: undefined,
      viewport: "custom",
      viewportName: "fixture",
      viewportWidth: 10,
      viewportHeight: 10,
      scope: "page",
      pageReason: "The selected frame is the complete page.",
      styleCheckSelector: undefined,
      styleCheckNodeId: undefined,
      selector: undefined,
      regionWidth: undefined,
      regionHeight: undefined,
    },
    nonInteractivePrompts,
    runtime(root),
    { fetchBaseline: fakeFetch() },
  );
  expect(created.exitCode).toBe(0);
  return root;
}

async function open(root: string): Promise<ContractPinning> {
  return openContractPinning(await openProject(root, runtime(root)).loadConfig());
}

function pinNew(root: string, pinning: ContractPinning, onFetch?: () => void) {
  const template = pinning.contracts[0]!.contract;
  return pinning.pin({
    contractPath: path.join(root, ".framelia/contracts/account.other/visual-contract.json"),
    existing: undefined,
    draft: { ...template, id: "account.other", revision: 1 },
    source: { kind: "figma", fileKey: "file-key", nodeId: "6006:1028" },
    token: undefined,
    fetchBaseline: fakeFetch(onFetch),
  });
}

describe("openContractPinning", () => {
  it("pins a new contract and writes its pointer", async () => {
    const root = await projectWithContract();
    const pinned = await pinNew(root, await open(root));
    expect(pinned.contract).toMatchObject({ id: "account.other", revision: 1 });
    expect(pinned.contract.baseline.snapshotDigest).toBe(pinned.snapshotDigest);
    const pointer = path.join(root, ".framelia/contracts/account.other/visual-contract.json");
    expect(JSON.parse(fs.readFileSync(pointer, "utf8"))).toEqual(pinned.contract);
  });

  it("rejects a create that loses the race to a concurrent create of the same id", async () => {
    const root = await projectWithContract();
    const first = await open(root);
    const second = await open(root);
    await pinNew(root, first);
    await expect(pinNew(root, second)).rejects.toMatchObject({
      code: "AUTHORING_CONFLICT",
      message: expect.stringContaining("created concurrently"),
    });
  });

  it("writes nothing when the project config changes during baseline acquisition", async () => {
    const root = await projectWithContract();
    const configPath = path.join(root, "framelia.config.mjs");
    await expect(
      pinNew(root, await open(root), () => fs.appendFileSync(configPath, "// edited\n")),
    ).rejects.toMatchObject({
      code: "AUTHORING_CONFLICT",
      message: expect.stringContaining("framelia.config.mjs changed"),
    });
    expect(
      fs.existsSync(path.join(root, ".framelia/contracts/account.other/visual-contract.json")),
    ).toBe(false);
  });

  it("refuses to open while any authored contract is invalid", async () => {
    const root = await projectWithContract();
    const malformed = path.join(root, ".framelia/contracts/malformed/visual-contract.json");
    fs.mkdirSync(path.dirname(malformed), { recursive: true });
    fs.writeFileSync(malformed, "{\n");
    await expect(open(root)).rejects.toMatchObject({
      code: "CONTRACT_FILE_INVALID",
      message: expect.stringContaining("must be repaired before authoring"),
    });
  });
});
