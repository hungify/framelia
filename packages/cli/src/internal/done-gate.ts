import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { signedAuthoritativeRunRequirementsSchema } from "@framelia/contracts/workflow";
import { canonicalJson, type CanonicalJsonValue } from "@framelia/verify";
import {
  evaluateAuthoritativeRun,
  type AuthoritativeRunVerdict,
} from "@framelia/verify/run-bundle";
import { z } from "zod";

import { TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV } from "../cli-constants.ts";
import { UsageError, usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";

const doneGateOptionsSchema = z.object({
  run: z.string().min(1).optional(),
  requirements: z.string().min(1).optional(),
  projectRoot: z.string().optional(),
  artifact: z.string().min(1).optional(),
});

export interface DoneGateOptions {
  readonly run: string | undefined;
  readonly requirements: string | undefined;
  readonly projectRoot: string | undefined;
  readonly artifact: string | undefined;
}

interface IncompleteGateVerdict {
  executionState: "incomplete";
  visualVerdict: "not-evaluated";
  exitCode: 2;
  issues: Array<{ code: string; message: string }>;
  next: { command: string; argv: string[] };
}

export type DoneGateResult = CliResult<
  | (AuthoritativeRunVerdict & {
      readonly requirements: { role: "protected-signed-envelope" };
      readonly verifier: {
        algorithm: "Ed25519";
        trustRoot: "external-to-project";
        keyFingerprint: string;
      };
    })
  | IncompleteGateVerdict
>;

function incomplete(code: string, message: string): DoneGateResult {
  return {
    ok: false,
    exitCode: 2,
    body: {
      executionState: "incomplete",
      visualVerdict: "not-evaluated",
      exitCode: 2,
      issues: [{ code, message }],
      next: { command: "pnpm", argv: ["exec", "playwright", "test"] },
    },
  };
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function decodeSignature(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64");
}

export async function doneGateCommand(
  options: DoneGateOptions,
  runtime: CliRuntime,
): Promise<DoneGateResult> {
  const parsed = doneGateOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  if (parsed.data.artifact) {
    let value: unknown;
    try {
      value = JSON.parse(
        fs.readFileSync(path.resolve(runtime.cwd(), parsed.data.artifact), "utf8"),
      );
    } catch {
      return incomplete(
        "LEGACY_ARTIFACT_UNREADABLE",
        "Legacy artifact could not be read. Rerun verification to produce a selected run bundle.",
      );
    }
    if (
      value !== null &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "framelia.visual-verification"
    ) {
      return incomplete(
        "LEGACY_ARTIFACT_UNSUPPORTED",
        "Legacy visual-verification.json has no trustworthy run/source provenance and cannot be authoritative. Rerun verification to produce a selected run bundle.",
      );
    }
    return incomplete(
      "LEGACY_ARTIFACT_UNSUPPORTED",
      "--artifact only recognizes legacy framelia.visual-verification input.",
    );
  }

  if (!parsed.data.run || !parsed.data.requirements) {
    throw new UsageError(
      "done-gate requires --run <id> and --requirements <signed-envelope-path>.",
    );
  }

  const project = openProject(parsed.data.projectRoot, runtime);
  const requirementsPath = path.resolve(runtime.cwd(), parsed.data.requirements);
  let envelopeValue: unknown;
  try {
    envelopeValue = JSON.parse(fs.readFileSync(requirementsPath, "utf8"));
  } catch {
    return incomplete(
      "SIGNED_REQUIREMENTS_UNREADABLE",
      "The protected signed requirements envelope could not be read.",
    );
  }
  const envelope = signedAuthoritativeRunRequirementsSchema.safeParse(envelopeValue);
  if (!envelope.success) {
    return incomplete("SIGNED_REQUIREMENTS_INVALID", envelope.error.message);
  }

  const configuredKeyPath = runtime.env[TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV];
  if (!configuredKeyPath) {
    return incomplete(
      "TRUST_ROOT_MISSING",
      `${TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV} must name a protected Ed25519 public key outside the project checkout.`,
    );
  }

  let projectRealPath: string;
  let keyRealPath: string;
  let publicKey: crypto.KeyObject;
  try {
    projectRealPath = fs.realpathSync(project.root);
    keyRealPath = fs.realpathSync(path.resolve(runtime.cwd(), configuredKeyPath));
    if (isInside(projectRealPath, keyRealPath)) {
      return incomplete(
        "TRUST_ROOT_INSIDE_PROJECT",
        "The authoritative requirements public key must be installed outside the project checkout.",
      );
    }
    publicKey = crypto.createPublicKey(fs.readFileSync(keyRealPath));
    if (publicKey.asymmetricKeyType !== "ed25519") {
      return incomplete("TRUST_ROOT_UNSUPPORTED", "The trust root must be an Ed25519 public key.");
    }
  } catch {
    return incomplete(
      "TRUST_ROOT_INVALID",
      "The protected external Ed25519 trust root could not be loaded.",
    );
  }

  const payloadBytes = Buffer.from(
    canonicalJson(envelope.data.payload as CanonicalJsonValue),
    "utf8",
  );
  const signature = decodeSignature(envelope.data.signature);
  if (!crypto.verify(null, payloadBytes, publicKey, signature)) {
    return incomplete(
      "SIGNED_REQUIREMENTS_SIGNATURE_INVALID",
      "The authoritative requirements signature is invalid for the protected trust root.",
    );
  }

  const keyFingerprint = `sha256:${crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")}`;
  try {
    const verdict = evaluateAuthoritativeRun(project.root, parsed.data.run, envelope.data.payload);
    return {
      ok: verdict.exitCode === 0,
      exitCode: verdict.exitCode,
      body: {
        requirements: { role: "protected-signed-envelope" },
        verifier: {
          algorithm: "Ed25519",
          trustRoot: "external-to-project",
          keyFingerprint,
        },
        ...verdict,
      },
    };
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "RUN_BUNDLE_INVALID";
    return incomplete(
      code,
      "The selected run bundle could not be evaluated. Inspect its portable integrity diagnostics.",
    );
  }
}
