import type { DashboardContractResult, DashboardVerdict } from "@framelia/contracts";

export type ContractStatusFilter = "all" | DashboardVerdict;

export type ContractTreeItem =
  | {
      id: string;
      label: string;
      kind: "feature";
      status: DashboardVerdict;
      children: ContractTreeLeaf[];
      leafCount: number;
      defaultExpanded?: boolean;
    }
  | ContractTreeLeaf;

export interface ContractTreeLeaf {
  id: string;
  label: string;
  kind: "contract";
  status: DashboardVerdict;
  contract: DashboardContractResult;
}

const VIEWPORT_TAGS = new Set(["desktop", "mobile", "tablet"]);
const VERDICT_PRIORITY: DashboardVerdict[] = [
  "failed",
  "blocked",
  "running",
  "queued",
  "masked-pass",
  "passed",
];

function titleCase(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function filterContracts(
  contracts: DashboardContractResult[],
  query: string,
  status: ContractStatusFilter,
): DashboardContractResult[] {
  const needle = query.trim().toLowerCase();
  return contracts.filter((contract) => {
    const statusMatch = status === "all" || contract.status === status;
    const queryMatch =
      !needle ||
      `${contract.id} ${contract.name} ${contract.tags.join(" ")}`.toLowerCase().includes(needle);
    return statusMatch && queryMatch;
  });
}

const STATUS_FILTERS = new Set<ContractStatusFilter>([
  "all",
  "queued",
  "running",
  "passed",
  "masked-pass",
  "failed",
  "blocked",
]);

/** Reads a status filter from an untrusted URL query value, defaulting to `all`. */
export function parseStatusFilter(value: unknown): ContractStatusFilter {
  return typeof value === "string" && STATUS_FILTERS.has(value as ContractStatusFilter)
    ? (value as ContractStatusFilter)
    : "all";
}

/**
 * The contract on screen. An explicit id (from the URL) is looked up in the whole run,
 * independent of the rail's search/status filter: filtering narrows the list, it never
 * changes or rewrites the selection. Only with no id does it default to the first
 * contract the rail displays.
 */
export function resolveSelectedContract(
  all: DashboardContractResult[],
  displayed: DashboardContractResult[],
  selectedId: string | undefined,
): DashboardContractResult | undefined {
  if (selectedId) return all.find((contract) => contract.id === selectedId);
  return displayed[0];
}

/** The tree's leaves in display order (feature groups, then their children). */
export function flattenContractTree(tree: ContractTreeItem[]): DashboardContractResult[] {
  return tree.flatMap((item) =>
    item.kind === "feature" ? item.children.map((child) => child.contract) : [item.contract],
  );
}

/**
 * The contract `direction` steps away from `currentId` in display order, wrapping at
 * either end. A selection that is filtered out of the list steps to the first (forward)
 * or last (backward) displayed contract.
 */
export function stepContract(
  displayed: DashboardContractResult[],
  currentId: string | undefined,
  direction: 1 | -1,
): DashboardContractResult | undefined {
  if (displayed.length === 0) return undefined;
  const index = displayed.findIndex((contract) => contract.id === currentId);
  if (index < 0) return direction === 1 ? displayed[0] : displayed.at(-1);
  const length = displayed.length;
  return displayed[(((index + direction) % length) + length) % length];
}

function contractChildLabel(
  contract: DashboardContractResult,
  normalizedFeatureKey: string,
): string {
  const idLower = contract.id.toLowerCase();
  const prefix = `${normalizedFeatureKey}.`;
  const suffix =
    idLower === normalizedFeatureKey
      ? ""
      : idLower.startsWith(prefix)
        ? contract.id.slice(prefix.length)
        : contract.id;
  if (suffix)
    return suffix
      .split(".")
      .map((part) => titleCase(part))
      .join(" · ");
  const viewport = contract.tags.find((tag) => VIEWPORT_TAGS.has(tag.toLowerCase()));
  return viewport ? titleCase(viewport) : contract.name;
}

function aggregateStatus(contracts: DashboardContractResult[]): DashboardVerdict {
  return (
    VERDICT_PRIORITY.find((verdict) => contracts.some((contract) => contract.status === verdict)) ??
    "passed"
  );
}

export function buildContractTree(
  contracts: DashboardContractResult[],
  suiteName?: string,
): ContractTreeItem[] {
  const groups = new Map<string, DashboardContractResult[]>();
  for (const contract of contracts) {
    const key = contract.feature ?? suiteName ?? "verification-run";
    const list = groups.get(key);
    if (list) list.push(contract);
    else groups.set(key, [contract]);
  }

  return [...groups.entries()].map(([suiteKey, groupContracts]) => {
    const normalizedKey = suiteKey.toLowerCase();
    const children: ContractTreeLeaf[] = groupContracts.map((contract) => ({
      id: `contract:${contract.id}`,
      label: contractChildLabel(contract, normalizedKey),
      kind: "contract",
      status: contract.status,
      contract,
    }));

    return {
      id: `suite:${normalizedKey || "verification-run"}`,
      label: titleCase(suiteKey),
      kind: "feature" as const,
      status: aggregateStatus(groupContracts),
      children,
      leafCount: children.length,
      defaultExpanded: true,
    };
  });
}

export function findContractTreeItem(
  tree: ContractTreeItem[],
  contractId: string | undefined,
): ContractTreeLeaf | undefined {
  if (!contractId) return undefined;
  for (const group of tree) {
    if (group.kind !== "feature") continue;
    const match = group.children.find((item) => item.contract.id === contractId);
    if (match) return match;
  }
  return undefined;
}
