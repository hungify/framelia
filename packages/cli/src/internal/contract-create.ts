import { VISUAL_CONTRACT_FILE, visualArtifactPath } from "@framelia/contracts";

import type { CliRuntime } from "../runtime-types.ts";
import {
  collectContractAnswers,
  type ContractCreateOptions,
  type ContractInterviewDependencies,
} from "./contract-interview.ts";
import { createContractRequest, writeContractRequest } from "./contract-scaffold.ts";
import { openProject } from "./project.ts";
import type { PromptAdapter } from "./prompts.ts";

export type { ContractCreateOptions } from "./contract-interview.ts";

export type ContractCreateResult =
  | { readonly ok: false; readonly body: { readonly cancelled: true } }
  | {
      readonly ok: true;
      readonly body: {
        readonly contractId: string;
        readonly outputPath: string;
        readonly outcome: "created" | "added" | "replaced";
      };
    };

export async function contractCreateCommand(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
  deps?: ContractInterviewDependencies,
): Promise<ContractCreateResult> {
  prompts.intro("Create Framelia visual contract");
  const interview = await collectContractAnswers(options, prompts, runtime, deps);
  if (interview.kind === "cancelled") {
    return { ok: false, body: { cancelled: true } };
  }

  const request = createContractRequest(interview.answers);
  const featureName = interview.answers.contractId.split(".")[0] ?? interview.answers.contractId;
  const project = openProject(options.projectRoot, runtime);
  const outputPath = project.resolve(
    options.output ?? visualArtifactPath(featureName, VISUAL_CONTRACT_FILE),
  );
  const outcome = writeContractRequest(outputPath, request, options.force);
  const verb =
    outcome === "created"
      ? "Created"
      : outcome === "added"
        ? "Added contract to"
        : "Replaced contract in";
  prompts.outro(`${verb} ${outputPath}`);
  return {
    ok: true,
    body: { contractId: interview.answers.contractId, outputPath, outcome },
  };
}
