import type { DashboardContractResult } from "@framelia/contracts";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from "vue-router";

import { useRunArtifact } from "../data-source";
import { resolveArtifactMode } from "../lib/artifact-mode";
import { contractForAttempt, inspectedAttempt } from "../lib/attempt-evidence";
import {
  buildContractTree,
  filterContracts,
  findContractTreeItem,
  flattenContractTree,
  parseStatusFilter,
  resolveSelectedContract,
  stepContract,
  type ContractStatusFilter,
} from "../lib/contract-tree";
import { isTypingTarget } from "../lib/dom";

const CONTRACT_ROUTE = "/(dashboard)/contracts/[...id]";

/**
 * The URL query for a search/status filter, keeping any unrelated keys. Empty search and
 * the `all` status are omitted so the default view keeps a clean URL.
 */
export function filterQuery(
  current: LocationQuery,
  search: string,
  status: ContractStatusFilter,
): LocationQueryRaw {
  const { q: _q, status: _status, ...rest } = current;
  return {
    ...rest,
    ...(search ? { q: search } : {}),
    ...(status === "all" ? {} : { status }),
  };
}

function queryString(value: LocationQuery[string] | undefined): string {
  return typeof value === "string" ? value : "";
}

export function useRunDashboard() {
  const route = useRoute();
  const router = useRouter();
  const {
    run,
    loading,
    error,
    refreshError,
    staticMode,
    liveMode,
    mockMode,
    connection,
    artifactUrl,
  } = useRunArtifact();

  // Search and status filter live in the URL query, so a filtered view survives reloads
  // and can be shared; the refs follow back/forward navigation too.
  const query = ref(queryString(route.query.q));
  const status = ref<ContractStatusFilter>(parseStatusFilter(route.query.status));
  watch(
    () => [route.query.q, route.query.status] as const,
    ([q, nextStatus]) => {
      query.value = queryString(q);
      status.value = parseStatusFilter(nextStatus);
    },
  );
  watch([query, status], ([search, nextStatus]) => {
    if (
      search === queryString(route.query.q) &&
      nextStatus === parseStatusFilter(route.query.status)
    )
      return;
    void router.replace({ query: filterQuery(route.query, search, nextStatus) });
  });

  const railOpen = ref(true);
  const detailsOpen = ref(true);

  const artifactMode = computed(() =>
    resolveArtifactMode({
      mockMode: mockMode.value,
      staticMode: staticMode.value,
      liveMode: liveMode.value,
    }),
  );

  const allContracts = computed(() => run.value?.contracts ?? []);
  const contracts = computed(() => filterContracts(allContracts.value, query.value, status.value));
  const contractTree = computed(() => buildContractTree(contracts.value, run.value?.suiteName));
  /** The rail's contracts in the order the tree displays them. */
  const displayedContracts = computed(() => flattenContractTree(contractTree.value));

  const selectedId = computed(() => {
    if (!("id" in route.params)) return undefined;
    const id = route.params.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  });

  // Selection comes from the URL alone; the filter never changes or rewrites it.
  const selected = computed(() =>
    resolveSelectedContract(allContracts.value, displayedContracts.value, selectedId.value),
  );
  /** A URL id that names no contract in this run (after loading finished). */
  const missingContractId = computed(() =>
    run.value && !selected.value && selectedId.value ? selectedId.value : undefined,
  );
  /** The selected contract is excluded by the current search/status filter. */
  const selectionFiltered = computed(
    () =>
      Boolean(selected.value) &&
      !displayedContracts.value.some((contract) => contract.id === selected.value?.id),
  );

  const selectedTreeItem = computed(() =>
    findContractTreeItem(contractTree.value, selected.value?.id),
  );

  // Retry evidence: which attempt the inspector shows. Undefined = the selected attempt.
  const attemptId = ref<string>();
  watch(
    () => selected.value?.id,
    () => {
      attemptId.value = undefined;
    },
  );
  const inspectedContract = computed(() =>
    selected.value ? contractForAttempt(selected.value, attemptId.value) : undefined,
  );
  const inspectedRetry = computed(() =>
    selected.value ? inspectedAttempt(selected.value, attemptId.value) : undefined,
  );
  function inspectAttempt(id: string | undefined) {
    attemptId.value = id;
  }

  function selectContract(contract: DashboardContractResult) {
    if (contract.id === selectedId.value) return;
    void router.push({ name: CONTRACT_ROUTE, params: { id: contract.id }, query: route.query });
  }

  function moveSelection(direction: 1 | -1) {
    const next = stepContract(displayedContracts.value, selected.value?.id, direction);
    if (next) selectContract(next);
  }

  function onKeydown(event: KeyboardEvent) {
    if (isTypingTarget(event.target)) return;
    if (!event.altKey) return;
    if (event.key === "ArrowRight") moveSelection(1);
    if (event.key === "ArrowLeft") moveSelection(-1);
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

  return {
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
  };
}
