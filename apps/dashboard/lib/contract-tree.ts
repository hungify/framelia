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

export function resolveSelectedContract(
  filtered: DashboardContractResult[],
  selectedId: string | undefined,
): DashboardContractResult | undefined {
  if (filtered.length === 0) return undefined;
  return filtered.find((contract) => contract.id === selectedId) ?? filtered[0];
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
