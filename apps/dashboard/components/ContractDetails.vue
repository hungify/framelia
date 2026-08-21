<script setup lang="ts">
import type { DashboardContractResult } from "@framelia/contracts";
import { computed } from "vue";

import { hasEvidenceNotes } from "../lib/contract-evidence";
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

const styleMismatches = computed(
  () =>
    props.contract.topIssues?.filter(
      (issue) => issue.kind === "style-color" || issue.kind === "style-typography",
    ) ?? [],
);

const actionsSummary = computed(() => {
  const actions = props.contract.captureEvidence?.actions ?? [];
  if (!actions.length) return "none";
  const passed = actions.filter((action) => action.status === "passed").length;
  const failed = actions.filter((action) => action.status === "failed").length;
  const attempts = actions.reduce((total, action) => total + action.attempts, 0);
  return `${passed} passed / ${failed} failed / ${attempts} attempts`;
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
      <code class="block mt-1 text-muted text-xs">{{ contract.id }}</code>
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
      v-if="hasEvidenceNotes(contract) || styleMismatches.length"
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
      <div v-if="styleMismatches.length" class="min-w-0">
        <span class="block text-muted text-xs"
          >Style mismatches vs. Figma — informational, not blocking</span
        >
        <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
          <li
            v-for="(issue, index) in styleMismatches"
            :key="`${issue.kind}-${index}`"
            class="min-w-0 text-xs leading-snug"
          >
            <code class="text-amber text-xs">{{ issue.kind }}</code>
            <span class="text-text-soft"> — {{ issue.message }}</span>
          </li>
        </ul>
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
