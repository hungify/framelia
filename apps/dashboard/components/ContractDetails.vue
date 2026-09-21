<script setup lang="ts">
import type { DashboardContractResult } from "@framelia/contracts";
import { computed } from "vue";

import {
  groupPixelAttributions,
  groupStyleMismatches,
  hasEvidenceNotes,
  styleMismatchGateLabel,
} from "../lib/contract-evidence";
import { formatRatio } from "../lib/format";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
  contract: DashboardContractResult;
}>();

const reviewNotice = computed(() => {
  if (!props.contract.diagnostics?.length && props.contract.status !== "blocked") return null;
  return props.contract.status === "blocked"
    ? {
        title: "Evidence blocked",
        message: "One or more capture facts prevent a reliable visual verdict.",
      }
    : {
        title: "Evidence requires review",
        message: "Font or capture caveat present; this is not a clean pass.",
      };
});

const readinessSummary = computed(() => {
  const readiness = props.contract.captureEvidence?.readiness;
  if (!readiness) return "not configured";
  const gate = readiness.selector ?? readiness.event ?? "no gate";
  const matches = readiness.matchCount !== undefined ? ` · ${readiness.matchCount} match(es)` : "";
  return `${readiness.status} · ${gate}${matches}`;
});

const fontStatusOk = computed(() => {
  const fonts = props.contract.captureEvidence?.fonts;
  return Boolean(fonts?.status === "loaded" && fonts.supported && !fonts.failed.length);
});

const fontStatusLabel = computed(() => {
  const fonts = props.contract.captureEvidence?.fonts;
  if (!fonts) return "";
  const label = fonts.supported ? fonts.status : "unsupported";
  return fonts.failed.length ? `${label} · ${fonts.failed.join(", ")}` : label;
});

const styleMismatchGroups = computed(() => groupStyleMismatches(props.contract.topIssues));

const styleMismatchLabel = computed(() => styleMismatchGateLabel(props.contract.styleGateEligible));

const pixelAttributionGroups = computed(() => groupPixelAttributions(props.contract.topIssues));

const actionsSummary = computed(() => {
  const actions = props.contract.captureEvidence?.actions ?? [];
  if (!actions.length) return "none";
  const passed = actions.filter((action) => action.status === "passed").length;
  const failed = actions.filter((action) => action.status === "failed").length;
  const attempts = actions.reduce((total, action) => total + action.attempts, 0);
  return `${passed} passed / ${failed} failed / ${attempts} attempts`;
});

const resolvedThresholdTooltip = computed(() => {
  const threshold = props.contract.resolvedThreshold;
  if (!threshold) return "";
  return [
    `profile: ${threshold.name}`,
    `minMatch: ${threshold.minMatch}`,
    `minSSIM: ${threshold.minSSIM}`,
    `maxAvgDeltaE: ${threshold.maxAvgDeltaE}`,
    `maxDiffPixels: ${threshold.maxDiffPixels ?? "unbounded"}`,
    `maxAreaGapPercent: ${threshold.maxAreaGapPercent}`,
    `cluster: ${threshold.cluster}`,
  ].join("\n");
});
</script>

<template>
  <div
    class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto pb-3.5 md:grid-cols-[minmax(220px,0.8fr)_minmax(340px,1.2fr)_minmax(260px,1fr)] md:grid-rows-[minmax(0,1fr)] md:items-start md:overflow-x-auto md:overflow-y-hidden md:pb-0 lg:grid-cols-[minmax(0,1fr)] lg:grid-rows-[auto_auto_minmax(0,1fr)] lg:items-stretch lg:overflow-x-hidden lg:overflow-y-auto lg:pb-3.5"
  >
    <header class="block px-3.5 pt-3.5 pb-2.5">
      <div class="flex items-center gap-2.25">
        <h1 class="m-0 text-base font-semibold">{{ contract.name }}</h1>
        <StatusBadge :status="contract.status" />
        <span v-if="contract.diagnostics?.length" class="text-amber text-xs font-medium"
          >evidence review</span
        >
      </div>
      <code v-if="contract.id !== contract.name" class="block mt-1 text-muted text-xs">{{
        contract.id
      }}</code>
    </header>
    <div
      v-if="reviewNotice"
      class="mx-3.5 mb-3 border border-amber/45 border-l-[3px] border-l-amber rounded-sm bg-amber/10 px-2.5 py-2 text-xs leading-snug"
      role="status"
    >
      <strong class="block text-amber">{{ reviewNotice.title }}</strong>
      <span class="text-text-soft">{{ reviewNotice.message }}</span>
    </div>
    <dl
      class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2.5 gap-y-3 w-full min-w-0 m-0 px-3.5 pb-3.5"
    >
      <div class="min-w-0">
        <dt class="text-muted text-xs">Diff ratio</dt>
        <dd
          class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs leading-tight font-mono"
        >
          {{ formatRatio(contract.comparison?.diffRatio) }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted text-xs">Pixels</dt>
        <dd
          class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs leading-tight font-mono"
        >
          {{ contract.comparison?.diffPixels?.toLocaleString() ?? "—" }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted text-xs">Viewport</dt>
        <dd
          class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs leading-tight font-mono"
        >
          {{ contract.capture.viewport.width }}×{{ contract.capture.viewport.height }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted text-xs">Baseline</dt>
        <dd
          class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs leading-tight font-mono"
        >
          {{ contract.baselineKind }}
        </dd>
      </div>
    </dl>
    <div
      v-if="contract.sourceRunId"
      class="mx-3.5 mb-3 border-t border-line-soft pt-3 text-xs"
      data-testid="selected-run-identity"
    >
      <span class="block text-muted">Source run</span>
      <code class="block mt-1 text-text-soft break-all">{{ contract.sourceRunId }}</code>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <span
          >Execution
          <strong class="block text-text">{{
            contract.executionState ?? "incomplete"
          }}</strong></span
        >
        <span
          >Visual
          <strong class="block text-text">{{
            contract.visualVerdict ?? "not-evaluated"
          }}</strong></span
        >
        <span
          >Project
          <strong class="block text-text"
            >{{ contract.projectName ?? "—" }} · repeat {{ contract.repeatIndex ?? 0 }}</strong
          ></span
        >
        <span
          >Target <code class="block text-text">{{ contract.targetPath ?? "—" }}</code></span
        >
      </div>
      <dl v-if="contract.provenance" class="mt-3 grid grid-cols-2 gap-2 text-text-soft">
        <div>
          <dt class="text-muted">Policy</dt>
          <dd class="m-0 break-all font-mono">{{ contract.provenance.policyDigest }}</dd>
        </div>
        <div>
          <dt class="text-muted">Retry policy</dt>
          <dd class="m-0">{{ contract.provenance.retryAcceptance }}</dd>
        </div>
        <div>
          <dt class="text-muted">Source / build</dt>
          <dd class="m-0 break-all font-mono">
            {{ contract.provenance.sourceDigest ?? "—" }} /
            {{ contract.provenance.buildDigest ?? "—" }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">Dirty</dt>
          <dd class="m-0">{{ contract.provenance.dirty ?? "unknown" }}</dd>
        </div>
        <div>
          <dt class="text-muted">Binding</dt>
          <dd class="m-0 break-all font-mono">{{ contract.provenance.bindingDigest }}</dd>
        </div>
        <div>
          <dt class="text-muted">Registration</dt>
          <dd class="m-0 break-all font-mono">
            {{ contract.provenance.specFile }} · {{ contract.provenance.specFileDigest }} ·
            {{ contract.provenance.titlePath.join(" › ") }}
          </dd>
        </div>
      </dl>
    </div>
    <div
      v-if="contract.attempts?.length"
      class="mx-3.5 mb-3 border-t border-line-soft pt-3"
      data-testid="retry-history"
    >
      <span class="block text-muted text-xs"
        >Attempts · selected {{ contract.selectedAttemptId ?? "none" }}</span
      >
      <div
        v-for="attempt in contract.attempts"
        :key="attempt.attemptId"
        class="mt-2 border border-line-soft rounded-sm p-2 text-xs"
      >
        <div class="flex justify-between gap-2">
          <code>{{ attempt.attemptId }}</code>
          <strong>{{ attempt.selected ? "selected" : `retry ${attempt.retryIndex}` }}</strong>
        </div>
        <div class="mt-1 text-muted">
          Execution {{ attempt.executionState }} · Visual {{ attempt.visualVerdict }}
        </div>
        <dl class="mt-2 grid grid-cols-1 gap-1 text-text-soft" data-testid="attempt-provenance">
          <div>
            <dt class="inline text-muted">Run / case plan:</dt>
            <dd class="inline ml-1 break-all font-mono">
              {{ attempt.runId }} / {{ attempt.casePlanDigest }}
            </dd>
          </div>
          <div v-if="attempt.baseline">
            <dt class="inline text-muted">Baseline:</dt>
            <dd class="inline ml-1 break-all font-mono">
              {{ attempt.baseline.snapshotDigest }} · {{ attempt.baseline.kind
              }}<template v-if="attempt.baseline.fileKey || attempt.baseline.nodeId">
                · {{ attempt.baseline.fileKey ?? "—" }}/{{
                  attempt.baseline.nodeId ?? "—"
                }}</template
              ><template v-if="attempt.baseline.sourceRunId">
                · source run {{ attempt.baseline.sourceRunId }}</template
              >
            </dd>
          </div>
          <div v-if="attempt.scoreProvenance">
            <dt class="inline text-muted">Score:</dt>
            <dd class="inline ml-1 break-all font-mono">
              v{{ attempt.scoreProvenance.formatVersion ?? "?" }} ·
              {{ attempt.scoreProvenance.digest }}
            </dd>
          </div>
        </dl>
        <ul class="mt-1.5 p-0 list-none grid grid-cols-2 gap-1">
          <li
            v-for="(evidence, kind) in attempt.evidence"
            :key="kind"
            :class="
              evidence.availability === 'available'
                ? 'text-green'
                : evidence.availability === 'not-recorded'
                  ? 'text-muted'
                  : 'text-amber'
            "
          >
            {{ kind }}: {{ evidence.availability }}
          </li>
        </ul>
        <dl v-if="attempt.comparison" class="mt-2 grid grid-cols-2 gap-1 text-text-soft">
          <div>
            <dt class="text-muted">Match</dt>
            <dd class="m-0 font-mono">{{ formatRatio(attempt.comparison.matchRatio) }}</dd>
          </div>
          <div>
            <dt class="text-muted">SSIM</dt>
            <dd class="m-0 font-mono">{{ formatRatio(attempt.comparison.ssim) }}</dd>
          </div>
          <div>
            <dt class="text-muted">ΔE</dt>
            <dd class="m-0 font-mono">{{ attempt.comparison.avgDeltaE ?? "—" }}</dd>
          </div>
          <div>
            <dt class="text-muted">Diff pixels</dt>
            <dd class="m-0 font-mono">{{ attempt.comparison.diffPixels ?? "—" }}</dd>
          </div>
        </dl>
        <ul
          v-if="attempt.topIssues.length || attempt.diagnostics.length || attempt.warnings.length"
          class="mt-2 mb-0 pl-4 text-text-soft"
        >
          <li v-for="issue in attempt.topIssues" :key="`issue:${issue.kind}:${issue.message}`">
            {{ issue.severity }} {{ issue.kind }}: {{ issue.message }}
          </li>
          <li
            v-for="diagnostic in attempt.diagnostics"
            :key="`diagnostic:${diagnostic.code}:${diagnostic.message}`"
          >
            {{ diagnostic.blocking ? "blocking " : "" }}{{ diagnostic.code }}:
            {{ diagnostic.message }}
          </li>
          <li v-for="warning in attempt.warnings" :key="`warning:${warning}`">
            warning: {{ warning }}
          </li>
        </ul>
      </div>
    </div>
    <div
      v-if="contract.resolvedThreshold"
      class="mx-3.5 mb-3 border-t border-line-soft pt-3"
      data-testid="resolved-threshold"
    >
      <span class="block text-muted text-xs"
        >Resolved threshold — {{ contract.resolvedThreshold.name }}</span
      >
      <div class="mt-1.5 flex flex-wrap gap-1.5" :title="resolvedThresholdTooltip">
        <UBadge variant="subtle" color="neutral" size="sm" class="font-mono! text-xs!"
          >match ≥ {{ formatRatio(contract.resolvedThreshold.minMatch) }}</UBadge
        >
        <UBadge variant="subtle" color="neutral" size="sm" class="font-mono! text-xs!"
          >SSIM ≥ {{ formatRatio(contract.resolvedThreshold.minSSIM) }}</UBadge
        >
        <UBadge variant="subtle" color="neutral" size="sm" class="font-mono! text-xs!"
          >ΔE ≤ {{ contract.resolvedThreshold.maxAvgDeltaE.toFixed(2) }}</UBadge
        >
        <UBadge variant="subtle" color="neutral" size="sm" class="font-mono! text-xs!"
          >px ≤
          {{ contract.resolvedThreshold.maxDiffPixels?.toLocaleString() ?? "unbounded" }}</UBadge
        >
        <UBadge
          variant="subtle"
          :color="contract.resolvedThreshold.cluster ? 'info' : 'neutral'"
          size="sm"
          class="font-mono! text-xs!"
          >cluster {{ contract.resolvedThreshold.cluster ? "on" : "off" }}</UBadge
        >
      </div>
    </div>
    <div v-if="contract.capture.target" class="mx-3.5 mb-3 border-t border-line-soft pt-3">
      <span class="block text-muted text-xs">Region / selector evidence</span>
      <div class="mt-1.5 overflow-x-auto">
        <table class="w-full min-w-82.5 text-left text-xs leading-snug">
          <thead class="text-muted">
            <tr>
              <th class="pb-1.5 font-medium">Selector</th>
              <th class="pb-1.5 font-medium">Match</th>
              <th class="pb-1.5 font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-t border-line-soft align-top">
              <td class="py-1.5 pr-2 font-mono text-text-soft break-all">
                {{ contract.capture.target.definition.value }}
              </td>
              <td
                class="py-1.5 pr-2"
                :class="contract.capture.target.stable ? 'text-green' : 'text-amber'"
              >
                {{
                  contract.capture.target.stable
                    ? `stable · ${contract.capture.target.matchCount}`
                    : `unmatched · ${contract.capture.target.matchCount}`
                }}
              </td>
              <td class="py-1.5 font-mono text-text-soft">
                {{
                  contract.capture.target.expectedSize
                    ? `${contract.capture.target.expectedSize.width}×${contract.capture.target.expectedSize.height}`
                    : "—"
                }}
                <template v-if="contract.capture.target.actualSize"
                  >→ {{ contract.capture.target.actualSize.width }}×{{
                    contract.capture.target.actualSize.height
                  }}</template
                >
              </td>
            </tr>
            <tr v-if="contract.capture.target.reason" class="border-t border-line-soft">
              <td colspan="3" class="py-1.5 text-amber">{{ contract.capture.target.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div
      v-if="
        hasEvidenceNotes(contract) || styleMismatchGroups.length || pixelAttributionGroups.length
      "
      class="flex flex-col gap-2.5 mx-3.5 mt-1 pt-3 border-t border-line-soft"
    >
      <div v-if="contract.blockers.length" class="min-w-0">
        <span class="block text-muted text-xs">Blockers</span>
        <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
          <li
            v-for="(blocker, index) in contract.blockers"
            :key="`${blocker.code}-${index}`"
            class="min-w-0 text-xs leading-snug"
          >
            <code class="text-amber text-xs">{{ blocker.code }}</code>
            <span class="text-text-soft"> — {{ blocker.message }}</span>
          </li>
        </ul>
      </div>
      <div v-if="contract.diagnostics?.length" class="min-w-0">
        <span class="block text-muted text-xs">Evidence notes — not a clean pass</span>
        <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
          <li
            v-for="(diagnostic, index) in contract.diagnostics"
            :key="`${diagnostic.code}-${index}`"
            class="min-w-0 text-xs leading-snug"
          >
            <code class="text-amber text-xs">{{ diagnostic.code }}</code>
            <span class="text-text-soft"> — {{ diagnostic.message }}</span>
          </li>
        </ul>
      </div>
      <div v-if="styleMismatchGroups.length" class="min-w-0" data-testid="style-mismatches">
        <span class="block text-muted text-xs" data-testid="style-mismatch-gate-label">{{
          styleMismatchLabel
        }}</span>
        <template
          v-for="group in styleMismatchGroups"
          :key="group.selector !== null ? `selector:${group.selector}` : 'unscoped'"
        >
          <code
            v-if="group.selector"
            class="block mt-1.5 text-amber text-xs font-mono"
            data-testid="style-mismatch-group-selector"
            >{{ group.selector }}</code
          >
          <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
            <li
              v-for="(issue, index) in group.issues"
              :key="`${issue.kind}-${index}`"
              class="min-w-0 text-xs leading-snug"
            >
              <code class="text-amber text-xs">{{ issue.kind }}</code>
              <span class="text-text-soft"> — {{ issue.message }}</span>
            </li>
          </ul>
        </template>
      </div>
      <div v-if="pixelAttributionGroups.length" class="min-w-0" data-testid="pixel-attributions">
        <span class="block text-muted text-xs">Pixel-diff regions attributed to check-points</span>
        <template
          v-for="group in pixelAttributionGroups"
          :key="group.selector !== null ? `selector:${group.selector}` : 'unscoped'"
        >
          <code
            v-if="group.selector"
            class="block mt-1.5 text-amber text-xs font-mono"
            data-testid="pixel-attribution-group-selector"
            >{{ group.selector }}</code
          >
          <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
            <li
              v-for="(issue, index) in group.issues"
              :key="`${issue.kind}-${index}`"
              class="min-w-0 text-xs leading-snug"
            >
              <span class="text-text-soft">{{ issue.message }}</span>
            </li>
          </ul>
        </template>
      </div>
      <div v-if="contract.maskEvidence" class="min-w-0">
        <span class="block text-muted text-xs"
          >Masks — {{ contract.maskEvidence.status }} ·
          {{ contract.maskEvidence.matchedCount }} region(s),
          {{ formatRatio(contract.maskEvidence.maskedAreaRatio) }} area</span
        >
        <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
          <li
            v-for="(mask, index) in contract.maskEvidence.requested"
            :key="`${mask.selector}-${index}`"
            class="text-xs leading-snug"
          >
            <code class="text-amber text-xs">{{ mask.selector }}</code>
            <span class="text-text-soft">
              — {{ mask.reason }}; {{ mask.matchedCount ?? "—" }} match(es)</span
            >
          </li>
        </ul>
        <div class="mt-1 text-xs text-muted font-mono">
          Bounds:
          {{
            contract.maskEvidence.bounds
              .map((bound) => `${bound.x},${bound.y} ${bound.width}×${bound.height}`)
              .join(" · ")
          }}
        </div>
      </div>
      <div v-if="contract.baseline?.provenance" class="min-w-0">
        <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-xs"
          >Baseline provenance</span
        >
        <code
          class="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.75 text-text-soft text-xs"
          >{{ contract.baseline.provenance }}</code
        >
      </div>
      <div v-if="contract.baseline?.promotedAt" class="min-w-0">
        <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-xs"
          >Baseline promoted</span
        >
        <code
          class="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.75 text-text-soft text-xs"
          >{{ contract.baseline.revision ? `${contract.baseline.revision} ` : "" }}by
          {{ contract.baseline.promotedBy ?? "unknown" }} at
          {{ new Date(contract.baseline.promotedAt).toLocaleString()
          }}{{ contract.baseline.runId ? ` (run ${contract.baseline.runId})` : "" }}</code
        >
      </div>
      <div v-if="contract.evidenceHash" class="min-w-0">
        <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-xs"
          >Evidence hash</span
        >
        <code
          class="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.75 text-text-soft text-xs"
          >{{ contract.evidenceHash }}</code
        >
      </div>
    </div>
    <details
      v-if="contract.captureEvidence"
      class="mx-3.5 mt-3 border-t border-line-soft pt-2.5 text-xs"
    >
      <summary class="cursor-pointer select-none text-text font-medium">
        Capture evidence
        <span class="text-muted font-normal"
          >· {{ contract.captureEvidence.warnings.length }} warning(s)</span
        >
      </summary>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 mt-2.5 text-text-soft">
        <dt class="text-muted">Final URL</dt>
        <dd class="min-w-0 break-all font-mono">{{ contract.captureEvidence.finalUrl }}</dd>
        <dt class="text-muted">Readiness</dt>
        <dd>{{ readinessSummary }}</dd>
        <dt class="text-muted">Fonts</dt>
        <dd :class="fontStatusOk ? 'text-green' : 'text-amber'">{{ fontStatusLabel }}</dd>
        <dt class="text-muted">Actions</dt>
        <dd>{{ actionsSummary }}</dd>
        <dt class="text-muted">Times</dt>
        <dd class="font-mono break-all">
          {{ contract.captureEvidence.startedAt }} → {{ contract.captureEvidence.capturedAt }} →
          {{ contract.captureEvidence.finishedAt }}
        </dd>
        <dt class="text-muted">Hashes</dt>
        <dd class="font-mono break-all">
          {{ contract.captureEvidence.screenshotHashes.join(", ") || "missing" }}
        </dd>
        <dt class="text-muted">Artifacts</dt>
        <dd class="font-mono break-all">
          {{ Object.values(contract.captureEvidence.artifactPaths).join(" · ") || "none" }}
        </dd>
      </dl>
      <ul
        v-if="contract.captureEvidence.actions.length || contract.captureEvidence.warnings.length"
        class="m-0 mt-2.5 p-0 list-none border-t border-line-soft pt-2 text-xs"
      >
        <li
          v-for="action in contract.captureEvidence.actions"
          :key="`${action.index}-${action.startedAt}`"
          :class="action.status === 'failed' ? 'text-amber' : 'text-muted'"
        >
          Action {{ action.index + 1 }} {{ action.kind }}: {{ action.status }} ·
          {{ action.attempts }} attempt(s)<template v-if="action.error">
            · {{ action.error }}</template
          >
        </li>
        <li v-for="warning in contract.captureEvidence.warnings" :key="warning" class="text-amber">
          Warning: {{ warning }}
        </li>
      </ul>
    </details>
  </div>
</template>
