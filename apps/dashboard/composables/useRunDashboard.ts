import type { DashboardContractResult } from "@framelia/contracts";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useRunArtifact } from "../data-source";
import { resolveArtifactMode } from "../lib/artifact-mode";
import {
  buildContractTree,
  filterContracts,
  findContractTreeItem,
  resolveSelectedContract,
  type ContractStatusFilter,
} from "../lib/contract-tree";
import { isTypingTarget } from "../lib/dom";

/** Wraps `direction` steps from `currentIndex` within a list of `length` items. */
export function nextSelectionIndex(
  currentIndex: number,
  direction: number,
  length: number,
): number {
  return (((currentIndex + direction) % length) + length) % length;
}

export function useRunDashboard() {
  const route = useRoute();
  const router = useRouter();
  const { run, loading, error, staticMode, liveMode, mockMode, artifactUrl } = useRunArtifact();

  const query = ref("");
  const status = ref<ContractStatusFilter>("all");
  const railOpen = ref(true);
  const detailsOpen = ref(true);

  const artifactMode = computed(() =>
    resolveArtifactMode({
      mockMode: mockMode.value,
      staticMode: staticMode.value,
      liveMode: liveMode.value,
    }),
  );

  const contracts = computed(() =>
    filterContracts(run.value?.contracts ?? [], query.value, status.value),
  );

  const selectedId = computed(() => {
    if (!("id" in route.params)) return undefined;
    const id = route.params.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  });

  const selected = computed(() => resolveSelectedContract(contracts.value, selectedId.value));

  watch(
    () => {
      if (!run.value || loading.value || error.value || !selectedId.value) return null;
      const contract = selected.value;
      if (!contract || contract.id === selectedId.value) return null;
      return contract.id;
    },
    (nextId) => {
      if (!nextId) return;
      void router.replace({ name: "/contracts/[...id]", params: { id: nextId } });
    },
  );

  const contractTree = computed(() => buildContractTree(contracts.value, run.value?.suiteName));
  const selectedTreeItem = computed(() =>
    findContractTreeItem(contractTree.value, selected.value?.id),
  );

  function selectContract(contract: DashboardContractResult) {
    if (contract.id === selectedId.value) return;
    void router.push({ name: "/contracts/[...id]", params: { id: contract.id } });
  }

  function moveSelection(direction: number) {
    if (!selected.value || contracts.value.length === 0) return;
    const index = contracts.value.findIndex((contract) => contract.id === selected.value?.id);
    if (index < 0) return;
    const next = contracts.value[nextSelectionIndex(index, direction, contracts.value.length)];
    if (next) selectContract(next);
  }

  function onKeydown(event: KeyboardEvent) {
    if (isTypingTarget(event.target)) return;
    if (!event.altKey) return;
    // Alt+Left/Right is also the browser's back/forward shortcut -- preventDefault it.
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(-1);
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

  return {
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
  };
}
