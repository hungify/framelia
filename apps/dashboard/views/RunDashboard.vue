<script setup lang="ts">
import ContractDetails from "../components/ContractDetails.vue";
import ContractRail from "../components/ContractRail.vue";
import ImageInspector from "../components/ImageInspector.vue";
import RunDashboardLayout from "../components/RunDashboardLayout.vue";
import { useRunDashboard } from "../composables/useRunDashboard";

const {
  run,
  loading,
  error,
  refreshError,
  connection,
  artifactMode,
  artifactUrl,
  query,
  status,
  railOpen,
  detailsOpen,
  contracts,
  selected,
  missingContractId,
  selectionFiltered,
  inspectedContract,
  inspectedRetry,
  inspectAttempt,
  contractTree,
  selectedTreeItem,
  selectContract,
} = useRunDashboard();
</script>

<template>
  <RunDashboardLayout
    v-model:rail-open="railOpen"
    v-model:details-open="detailsOpen"
    :loading="loading"
    :error="error"
    :refresh-error="refreshError"
    :has-run="Boolean(run)"
    :title="selected?.name ?? run?.suiteName ?? 'Verification run'"
    :subtitle="selected?.id ?? run?.runId"
    :artifact-mode="artifactMode"
    :connection="connection"
    :show-details="Boolean(selected)"
  >
    <template v-if="run" #rail>
      <ContractRail
        v-model:query="query"
        v-model:status="status"
        :run="run"
        :contracts-count="contracts.length"
        :contract-tree="contractTree"
        :selected-tree-item="selectedTreeItem"
        :selection-filtered="selectionFiltered"
        @select="selectContract"
      />
    </template>

    <ImageInspector
      v-if="inspectedContract"
      :contract="inspectedContract"
      :attempt="inspectedRetry"
      :artifact-url="artifactUrl"
      @show-selected-attempt="inspectAttempt(undefined)"
    />
    <div
      v-else
      class="h-full flex flex-col items-center justify-center gap-1.5 px-6 text-muted text-center text-sm"
    >
      <template v-if="missingContractId">
        <strong class="text-text text-base">Contract not found</strong>
        <p class="m-0 text-xs">
          <code>{{ missingContractId }}</code> is not part of this run.
        </p>
      </template>
      <template v-else>No contract selected.</template>
    </div>

    <template v-if="selected" #details>
      <ContractDetails
        :contract="selected"
        :inspected-attempt-id="inspectedRetry?.attemptId"
        @inspect-attempt="inspectAttempt"
      />
    </template>
  </RunDashboardLayout>
</template>
