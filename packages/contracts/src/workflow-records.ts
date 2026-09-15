import * as z from "zod";

import { baselineSchema } from "./baseline.ts";
import { CONTRACT_ID_PATTERN } from "./constants.ts";
import { nonEmptyTrimmed } from "./primitives.ts";
import {
  componentProfileSchema,
  contractScopeSchema,
  expectStyleSchema,
  profileOverridesSchema,
  styleCheckPointSchema,
  styleToleranceOverridesSchema,
  viewportSchema,
  visualMaskSchema,
} from "./visual-contract.ts";

export const CONTRACT_FORMAT_VERSION = 1;
export const SNAPSHOT_FORMAT_VERSION = 1;
export const BINDING_FORMAT_VERSION = 1;
export const TEST_REGISTRATION_FORMAT_VERSION = 1;
export const COLLECTION_FORMAT_VERSION = 1;
export const CASE_PLAN_FORMAT_VERSION = 1;
export const RUN_PLAN_FORMAT_VERSION = 1;
export const RUN_FORMAT_VERSION = 1;
export const ATTEMPT_FORMAT_VERSION = 1;
export const COMMAND_OUTCOME_FORMAT_VERSION = 1;

export const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const projectRelativePathSchema = nonEmptyTrimmed.refine(
  (value) => {
    // Rejects a POSIX-absolute leading slash/backslash, and a Windows drive
    // reference in either form: "C:\"/"C:/" (drive-absolute) and the more easily
    // missed "C:foo" (drive-relative -- resolves against that drive's own current
    // directory, which path.resolve() can't be trusted to keep inside `root`).
    if (/^(?:[\\/]|[A-Za-z]:)/.test(value)) return false;
    return !value.split(/[\\/]/).includes("..");
  },
  { message: "must be project-relative without parent traversal" },
);

export const targetPathSchema = nonEmptyTrimmed.refine(
  (value) => value.startsWith("/") && !value.startsWith("//"),
  { message: "must be an application path beginning with one slash" },
);

const uniqueStrings = <T extends z.ZodType<string>>(item: T) =>
  z
    .array(item)
    .min(1)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({ code: "custom", path: [index], message: `duplicate value: ${value}` });
        }
        seen.add(value);
      });
    });

export const projectNameSchema = z.string();
export const projectNamesSchema = uniqueStrings(projectNameSchema);

export const authoredContractSchema = z
  .object({
    formatVersion: z.literal(CONTRACT_FORMAT_VERSION),
    kind: z.literal("framelia.contract"),
    id: z.string().regex(CONTRACT_ID_PATTERN),
    name: nonEmptyTrimmed,
    revision: z.number().int().positive(),
    target: z.object({ path: targetPathSchema }).strict(),
    viewport: viewportSchema,
    scope: contractScopeSchema,
    baseline: z.object({ snapshotDigest: sha256DigestSchema }).strict(),
    required: z.boolean().default(true),
    projects: projectNamesSchema.optional(),
    profile: componentProfileSchema.optional(),
    profileOverrides: profileOverridesSchema.optional(),
    styleToleranceOverrides: styleToleranceOverridesSchema.optional(),
    gateEligible: z.boolean().optional(),
    styleGateEligible: z.boolean().optional(),
    masks: z.array(visualMaskSchema).min(1).optional(),
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.scope.kind === "page" && contract.profile != null) {
      context.addIssue({
        code: "custom",
        path: ["profile"],
        message: "page contract must not set component profile",
      });
    }
  });

const snapshotFileSchema = z
  .object({
    path: projectRelativePathSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const baselineSnapshotSchema = z
  .object({
    formatVersion: z.literal(SNAPSHOT_FORMAT_VERSION),
    kind: z.literal("framelia.baseline-snapshot"),
    source: baselineSchema,
    rendering: z
      .object({
        viewport: viewportSchema,
        deviceScaleFactor: z.number().positive().max(4),
      })
      .strict(),
    expected: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("page"),
          image: snapshotFileSchema.extend({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          }),
          style: snapshotFileSchema.optional(),
          styleChecks: z.array(styleCheckPointSchema).min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("region"),
          image: snapshotFileSchema.extend({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          }),
          style: snapshotFileSchema.optional(),
          expectStyle: expectStyleSchema.optional(),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    // A page-scope capture is always viewport-sized (see captureReadyPage's
    // fullPage:false convention for a pinned page snapshot), so its expected image
    // dimensions are fully determined by rendering.viewport × deviceScaleFactor and
    // can be cross-checked. A region-scope capture is sized to whatever element the
    // contract's own selector resolves to -- unrelated to the viewport -- so this
    // schema has no independent way to know its correct dimensions; only the field's
    // own positive-integer constraint above applies there.
    if (snapshot.expected.kind !== "page") return;
    const expectedWidth = snapshot.rendering.viewport.width * snapshot.rendering.deviceScaleFactor;
    const expectedHeight =
      snapshot.rendering.viewport.height * snapshot.rendering.deviceScaleFactor;
    if (snapshot.expected.image.width !== expectedWidth) {
      context.addIssue({
        code: "custom",
        path: ["expected", "image", "width"],
        message: `must equal CSS viewport width × deviceScaleFactor (${expectedWidth})`,
      });
    }
    if (snapshot.expected.image.height !== expectedHeight) {
      context.addIssue({
        code: "custom",
        path: ["expected", "image", "height"],
        message: `must equal CSS viewport height × deviceScaleFactor (${expectedHeight})`,
      });
    }
  });

export const contractBindingSchema = z
  .object({
    formatVersion: z.literal(BINDING_FORMAT_VERSION),
    kind: z.literal("framelia.contract-binding"),
    contractId: z.string().regex(CONTRACT_ID_PATTERN),
    contractFile: projectRelativePathSchema,
    contractDigest: sha256DigestSchema,
  })
  .strict();

/**
 * The full `framelia.contract` Playwright annotation payload `defineFigmaTests`
 * attaches to every test it registers -- `binding` (which contract this test binds to)
 * plus `specFile`/`specDigest`, this registration's own spec-file identity (see that
 * package's own `specUrl` option): `specFile` is the project-relative path `specUrl`
 * resolved to (the same portable-path convention `binding.contractFile` already uses),
 * `specDigest` is that file's registration-time content digest. `specFile` exists so a
 * later reader (`buildCasePlanForTest`, `defineFigmaTests`'s own precapture check) can
 * verify the caller-supplied `specUrl` actually matches the file Playwright's own
 * collected `type: "file"` Suite (its own `.title`, resolved against the project's
 * `testDir`) says registered this test -- without it, a caller could pass an arbitrary
 * stable file (or the wrong file entirely) whose digest has nothing to do with what's
 * actually executing, and nothing would ever catch the mismatch. Deliberately NOT
 * `TestCase.location.file`/`TestInfo.file`: both report where `test(...)` was
 * textually called (a stack-trace-derived location), which for every
 * `defineFigmaTests` registration is this library's own call site, never the caller's
 * spec file -- confirmed empirically against a real `playwright test` run.
 *
 * Both fields are deliberately a sibling of `binding`, not folded into
 * `contractBindingSchema`: a binding's own identity is "which contract, at which
 * digest" and is meaningful independent of which spec file happens to import it
 * (`collectedCaseSchema` below already establishes this precedent -- its own
 * `specFile`/`specFileDigest` sit beside `binding`, not inside it). Keeping spec
 * identity out of `contractBindingSchema` also keeps `casePlanSchema`'s own
 * `bindingDigest` (computed as `canonicalJsonDigest(binding)`) answering exactly one
 * question -- has the contract binding drifted -- never conflated with "has the spec
 * file drifted," which `casePlanSchema`'s own separate `specFileDigest` field already
 * answers.
 */
export const testRegistrationSchema = z
  .object({
    formatVersion: z.literal(TEST_REGISTRATION_FORMAT_VERSION),
    kind: z.literal("framelia.test-registration"),
    binding: contractBindingSchema,
    specFile: projectRelativePathSchema,
    specDigest: sha256DigestSchema,
  })
  .strict();

export const collectedCaseSchema = z
  .object({
    binding: contractBindingSchema,
    project: projectNameSchema,
    specFile: projectRelativePathSchema,
    specFileDigest: sha256DigestSchema,
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
    titlePath: z.array(nonEmptyTrimmed).min(1),
    repeatIndex: z.number().int().nonnegative(),
    dependencies: z.array(projectNameSchema).default([]),
  })
  .strict();

export const collectionManifestSchema = z
  .object({
    formatVersion: z.literal(COLLECTION_FORMAT_VERSION),
    kind: z.literal("framelia.collection"),
    createdAt: z.iso.datetime(),
    policyDigest: sha256DigestSchema,
    cases: z.array(collectedCaseSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    manifest.cases.forEach((entry, index) => {
      const key = `${entry.binding.contractId}\u0000${entry.project}\u0000${entry.repeatIndex}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index],
          message: `duplicate collected contract/project/repeat case: ${entry.binding.contractId}/${entry.project}/${entry.repeatIndex}`,
        });
      }
      seen.add(key);
    });
  });

export const sourceIdentitySchema = z
  .object({
    sourceDigest: sha256DigestSchema.optional(),
    buildDigest: sha256DigestSchema.optional(),
    dirty: z.boolean().optional(),
  })
  .strict();

export const casePlanSchema = z
  .object({
    formatVersion: z.literal(CASE_PLAN_FORMAT_VERSION),
    kind: z.literal("framelia.case-plan"),
    caseId: nonEmptyTrimmed,
    contract: z
      .object({
        id: z.string().regex(CONTRACT_ID_PATTERN),
        file: projectRelativePathSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
    snapshotDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    bindingDigest: sha256DigestSchema,
    /** Project-relative path to the spec file that registered this case -- kept so a
     *  later reconciliation pass (see @framelia/verify's run-bundle finalization) can
     *  relocate and re-hash it against `specFileDigest`, catching a spec edited after
     *  the case plan was frozen. */
    specFile: projectRelativePathSchema,
    specFileDigest: sha256DigestSchema,
    project: z
      .object({
        name: projectNameSchema,
        runtimeDigest: sha256DigestSchema,
      })
      .strict(),
    repeatIndex: z.number().int().nonnegative(),
    source: sourceIdentitySchema,
  })
  .strict();

const plannedCaseSchema = z
  .object({
    caseId: nonEmptyTrimmed,
    casePlanDigest: sha256DigestSchema,
  })
  .strict();

export const runSelectionSchema = z
  .object({
    mode: z.enum(["all", "subset"]),
    contracts: uniqueStrings(z.string().regex(CONTRACT_ID_PATTERN)),
    projects: projectNamesSchema.optional(),
  })
  .strict();

export const runPlanSchema = z
  .object({
    formatVersion: z.literal(RUN_PLAN_FORMAT_VERSION),
    kind: z.literal("framelia.run-plan"),
    runId: nonEmptyTrimmed,
    policyDigest: sha256DigestSchema,
    selection: runSelectionSchema,
    availableCases: z.array(plannedCaseSchema).min(1),
    requiredCases: z.array(plannedCaseSchema),
    selectedCases: z.array(plannedCaseSchema).min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    const available = new Map<string, string>();
    plan.availableCases.forEach((entry, index) => {
      if (available.has(entry.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["availableCases", index, "caseId"],
          message: `duplicate available case: ${entry.caseId}`,
        });
      }
      available.set(entry.caseId, entry.casePlanDigest);
    });

    const required = new Map<string, string>();
    plan.requiredCases.forEach((entry, index) => {
      if (required.has(entry.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["requiredCases", index, "caseId"],
          message: `duplicate required case: ${entry.caseId}`,
        });
      }
      required.set(entry.caseId, entry.casePlanDigest);
      if (available.get(entry.caseId) !== entry.casePlanDigest) {
        context.addIssue({
          code: "custom",
          path: ["requiredCases", index],
          message: `required case is absent or changed in available cases: ${entry.caseId}`,
        });
      }
    });

    const selected = new Set<string>();
    for (const [index, entry] of plan.selectedCases.entries()) {
      if (selected.has(entry.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["selectedCases", index, "caseId"],
          message: `duplicate selected case: ${entry.caseId}`,
        });
      }
      selected.add(entry.caseId);
      if (available.get(entry.caseId) !== entry.casePlanDigest) {
        context.addIssue({
          code: "custom",
          path: ["selectedCases", index],
          message: `selected case is absent or changed in available cases: ${entry.caseId}`,
        });
      }
    }

    if (
      plan.selection.mode === "all" &&
      (selected.size !== required.size ||
        [...required.keys()].some((caseId) => !selected.has(caseId)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedCases"],
        message: "all selection must include every required case and no optional cases",
      });
    }
  });

export const diagnosticSchema = z
  .object({
    code: nonEmptyTrimmed,
    stage: nonEmptyTrimmed,
    message: nonEmptyTrimmed,
    field: nonEmptyTrimmed.optional(),
    selector: nonEmptyTrimmed.optional(),
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    path: projectRelativePathSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const attemptRecordSchema = z
  .object({
    formatVersion: z.literal(ATTEMPT_FORMAT_VERSION),
    kind: z.literal("framelia.attempt"),
    attemptId: nonEmptyTrimmed,
    caseId: nonEmptyTrimmed,
    casePlanDigest: sha256DigestSchema,
    retryIndex: z.number().int().nonnegative(),
    executionState: z.enum(["completed", "blocked", "incomplete", "error"]),
    visualVerdict: z.enum(["passed", "mismatched", "not-evaluated"]),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    diagnostics: z.array(diagnosticSchema),
    evidence: z
      .object({
        expected: evidenceReferenceSchema.optional(),
        actual: evidenceReferenceSchema.optional(),
        diff: evidenceReferenceSchema.optional(),
        score: evidenceReferenceSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.executionState === "completed" && !attempt.completedAt) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completed attempt must have completedAt",
      });
    }
    // Skips, blocks, incomplete runs (timeout/interruption), and writer/comparison errors
    // can never resolve to a visual pass -- only a fully completed execution that actually
    // ran the capture/compare pipeline to a definitive verdict may claim "passed". This is
    // the schema-level guard for framelia/#77's acceptance criterion: "Skips, missing
    // results, writer failures, cancellation and interruptions cannot become visual passes."
    if (attempt.visualVerdict === "passed" && attempt.executionState !== "completed") {
      context.addIssue({
        code: "custom",
        path: ["visualVerdict"],
        message: `a "passed" visual verdict requires executionState "completed" (got "${attempt.executionState}")`,
      });
    }
  });

export const runRecordSchema = z
  .object({
    formatVersion: z.literal(RUN_FORMAT_VERSION),
    kind: z.literal("framelia.run"),
    runId: nonEmptyTrimmed,
    planDigest: sha256DigestSchema,
    status: z.enum(["planned", "running", "finalized", "incomplete", "error"]),
    createdAt: z.iso.datetime(),
    finalizedAt: z.iso.datetime().optional(),
    cases: z.array(
      z
        .object({
          caseId: nonEmptyTrimmed,
          attemptIds: z.array(nonEmptyTrimmed),
          selectedAttemptId: nonEmptyTrimmed.optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((run, context) => {
    const caseIds = new Set<string>();
    run.cases.forEach((entry, index) => {
      if (caseIds.has(entry.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `duplicate run case: ${entry.caseId}`,
        });
      }
      caseIds.add(entry.caseId);

      const attemptIds = new Set<string>();
      entry.attemptIds.forEach((attemptId, attemptIndex) => {
        if (attemptIds.has(attemptId)) {
          context.addIssue({
            code: "custom",
            path: ["cases", index, "attemptIds", attemptIndex],
            message: `duplicate attempt id: ${attemptId}`,
          });
        }
        attemptIds.add(attemptId);
      });
      if (entry.selectedAttemptId && !attemptIds.has(entry.selectedAttemptId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "selectedAttemptId"],
          message: "selected attempt must belong to the case",
        });
      }
    });
    if (run.status === "finalized" && !run.finalizedAt) {
      context.addIssue({
        code: "custom",
        path: ["finalizedAt"],
        message: "finalized run must have finalizedAt",
      });
    }
  });

export const commandOutcomeSchema = z
  .object({
    formatVersion: z.literal(COMMAND_OUTCOME_FORMAT_VERSION),
    kind: z.literal("framelia.command-outcome"),
    command: nonEmptyTrimmed,
    executionState: z.enum(["completed", "blocked", "incomplete", "error"]),
    visualVerdict: z.enum(["passed", "mismatched", "not-evaluated"]),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    runId: nonEmptyTrimmed.optional(),
    bundlePath: projectRelativePathSchema.optional(),
    diagnostics: z.array(diagnosticSchema),
    next: z
      .object({
        command: nonEmptyTrimmed,
        argv: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((outcome, context) => {
    const expectedExitCode =
      outcome.executionState !== "completed" ? 2 : outcome.visualVerdict === "mismatched" ? 1 : 0;
    if (outcome.exitCode !== expectedExitCode) {
      context.addIssue({
        code: "custom",
        path: ["exitCode"],
        message: `must be ${expectedExitCode} for ${outcome.executionState}/${outcome.visualVerdict}`,
      });
    }
  });

export type AuthoredContract = z.infer<typeof authoredContractSchema>;
export type BaselineSnapshot = z.infer<typeof baselineSnapshotSchema>;
export type ContractBinding = z.infer<typeof contractBindingSchema>;
export type TestRegistration = z.infer<typeof testRegistrationSchema>;
export type CollectedCase = z.infer<typeof collectedCaseSchema>;
export type CollectionManifest = z.infer<typeof collectionManifestSchema>;
export type SourceIdentity = z.infer<typeof sourceIdentitySchema>;
export type CasePlan = z.infer<typeof casePlanSchema>;
export type RunSelection = z.infer<typeof runSelectionSchema>;
export type RunPlan = z.infer<typeof runPlanSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type AttemptRecord = z.infer<typeof attemptRecordSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;
