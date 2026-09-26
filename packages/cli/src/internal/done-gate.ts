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

import {
  AUTHORITY_AUDIENCE_ENV,
  MAX_SIGNED_REQUIREMENTS_VALIDITY_MS,
  PROTECTED_JOB_IDENTITY_ENV,
  TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV,
} from "../cli-constants.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";
import { readRunProjection, type RunProjection } from "./run-projection.ts";

const doneGateOptionsSchema = z.object({
  run: z.string().min(1).optional(),
  requirements: z.string().min(1).optional(),
  projectRoot: z.string().optional(),
});

export interface DoneGateOptions {
  readonly run: string | undefined;
  readonly requirements: string | undefined;
  readonly projectRoot: string | undefined;
}

interface IncompleteGateVerdict {
  formatVersion: 1;
  kind: "framelia.done-gate-outcome";
  command: "done-gate";
  executionState: "incomplete";
  visualVerdict: "not-evaluated";
  exitCode: 2;
  issues: Array<{ code: string; message: string }>;
  next: { command: string; argv: string[] };
}

export type DoneGateResult = CliResult<
  | (AuthoritativeRunVerdict & {
      readonly formatVersion: 1;
      readonly kind: "framelia.done-gate-outcome";
      readonly command: "done-gate";
      readonly bundlePath: string;
      readonly run: RunProjection;
      readonly requirements: {
        role: "protected-signed-envelope";
        runId: string;
        issuedAt: string;
        expiresAt: string;
        jobIdentity: string;
        audience: string;
      };
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
      formatVersion: 1,
      kind: "framelia.done-gate-outcome",
      command: "done-gate",
      executionState: "incomplete",
      visualVerdict: "not-evaluated",
      exitCode: 2,
      issues: [{ code, message }],
      next: { command: "framelia", argv: ["check", "--all"] },
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
  now: () => Date = () => new Date(),
): Promise<DoneGateResult> {
  const parsed = doneGateOptionsSchema.safeParse(options);
  if (!parsed.success) {
    return incomplete("DONE_GATE_OPTIONS_INVALID", parsed.error.message);
  }

  if (!parsed.data.run || !parsed.data.requirements) {
    return incomplete(
      "DONE_GATE_OPTIONS_INVALID",
      "done-gate requires --run <id> and --requirements <signed-envelope-path>.",
    );
  }

  let project: ReturnType<typeof openProject>;
  try {
    project = openProject(parsed.data.projectRoot, runtime);
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "PROJECT_CONFIGURATION_INVALID";
    return incomplete(code, "The selected project root or Framelia configuration is invalid.");
  }
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
  const payload = envelope.data.payload;
  if (payload.runId !== parsed.data.run) {
    return incomplete(
      "SIGNED_REQUIREMENTS_RUN_MISMATCH",
      `Signed requirements name run "${payload.runId}", not requested run "${parsed.data.run}".`,
    );
  }
  const currentTime = now().getTime();
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (expiresAt - issuedAt > MAX_SIGNED_REQUIREMENTS_VALIDITY_MS) {
    return incomplete(
      "SIGNED_REQUIREMENTS_WINDOW_TOO_LARGE",
      "The signed requirements validity window exceeds the protected maximum.",
    );
  }
  if (currentTime < issuedAt) {
    return incomplete(
      "SIGNED_REQUIREMENTS_NOT_YET_VALID",
      "The signed requirements are not yet valid.",
    );
  }
  if (currentTime >= expiresAt) {
    return incomplete("SIGNED_REQUIREMENTS_EXPIRED", "The signed requirements have expired.");
  }
  const protectedJobIdentity = runtime.env[PROTECTED_JOB_IDENTITY_ENV];
  if (!protectedJobIdentity) {
    return incomplete(
      "PROTECTED_JOB_IDENTITY_MISSING",
      `${PROTECTED_JOB_IDENTITY_ENV} must be supplied by protected job runtime metadata.`,
    );
  }
  if (protectedJobIdentity !== payload.jobIdentity) {
    return incomplete(
      "PROTECTED_JOB_IDENTITY_MISMATCH",
      "Signed requirements do not match the protected runtime job identity.",
    );
  }
  const protectedAudience = runtime.env[AUTHORITY_AUDIENCE_ENV];
  if (!protectedAudience) {
    return incomplete(
      "PROTECTED_AUTHORITY_AUDIENCE_MISSING",
      `${AUTHORITY_AUDIENCE_ENV} must be supplied by protected job runtime metadata.`,
    );
  }
  if (protectedAudience !== payload.audience) {
    return incomplete(
      "PROTECTED_AUTHORITY_AUDIENCE_MISMATCH",
      "Signed requirements do not match the protected runtime audience.",
    );
  }

  const keyFingerprint = `sha256:${crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")}`;
  try {
    const projection = readRunProjection(project.root, parsed.data.run);
    const verdict = evaluateAuthoritativeRun(project.root, parsed.data.run, payload);
    return {
      ok: verdict.exitCode === 0,
      exitCode: verdict.exitCode,
      body: {
        formatVersion: 1,
        kind: "framelia.done-gate-outcome",
        command: "done-gate",
        bundlePath: projection.bundlePath,
        run: projection,
        requirements: {
          role: "protected-signed-envelope",
          runId: payload.runId,
          issuedAt: payload.issuedAt,
          expiresAt: payload.expiresAt,
          jobIdentity: payload.jobIdentity,
          audience: payload.audience,
        },
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
