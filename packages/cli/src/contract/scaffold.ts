import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCHEMA_VERSION,
  verificationRequestSchema,
  visualArtifactPath,
  type ExpectStyle,
  type StyleCheckPoint,
  type VerificationRequest,
} from "@framelia/contracts";
import { JSON_INDENT_SPACES } from "@framelia/verify";

export interface ContractAnswers {
  targetUrl: string;
  contractId: string;
  baseline: { kind: "figma"; fileKey: string; nodeId: string };
  viewport: { name: string; width: number; height: number };
  scope:
    | { kind: "page"; pageReason: string; styleChecks?: StyleCheckPoint[] }
    | {
        kind: "region";
        selector: string;
        expectSize: { width: number; height: number };
        expectStyle?: ExpectStyle;
      };
}

export function createContractRequest(answers: ContractAnswers): VerificationRequest {
  const outDirName = answers.contractId.replaceAll(".", "/");
  return verificationRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    target: { kind: "web", url: answers.targetUrl },
    contracts: [
      {
        id: answers.contractId,
        baseline: answers.baseline,
        viewport: answers.viewport,
        outDir: visualArtifactPath(outDirName),
        scope: answers.scope,
        ...(answers.scope.kind === "region" ? { profile: "component/strict" as const } : {}),
      },
    ],
  });
}

export function writeContractRequest(
  outputPath: string,
  request: VerificationRequest,
  force = false,
): void {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${resolved}. Pass --force to replace it.`,
    );
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(request, null, JSON_INDENT_SPACES)}\n`, "utf8");
}
