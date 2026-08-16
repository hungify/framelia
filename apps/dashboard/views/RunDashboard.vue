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
  artifactMode,
  artifactUrl,
  query,
  status,
  railOpen,
  detailsOpen,
  contracts,
  selected,
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
    :has-run="Boolean(run)"
    :title="selected?.name ?? run?.suiteName ?? 'Verification run'"
    :subtitle="selected?.id ?? run?.runId"
    :artifact-mode="artifactMode"
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
        @select="selectContract"
      />
    </template>

    <ImageInspector v-if="selected" :contract="selected" :artifact-url="artifactUrl" />
    <div v-else class="h-full flex items-center justify-center text-muted text-sm">
      No contract selected.
    </div>

    <template v-if="selected" #details>
      <ContractDetails :contract="selected" />
    </template>
  </RunDashboardLayout>
</template>
