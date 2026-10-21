import { renderToString } from "@vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";

import ContractDetails from "../components/ContractDetails.vue";
import ContractRail from "../components/ContractRail.vue";
import { buildContractTree } from "../lib/contract-tree";
import { dashboardMockRun } from "../mocks/dashboard";

const BadgeStub = defineComponent({
  setup(_props, { slots }) {
    return () => h("span", slots.default?.());
  },
});

const ComponentStub = defineComponent({
  setup(_props, { slots }) {
    return () => h("div", slots.default?.());
  },
});

describe("ContractDetails", () => {
  it("renders case-level and per-attempt provenance with earlier retry evidence", async () => {
    const contract = dashboardMockRun.contracts[0]!;
    const app = createSSRApp({ render: () => h(ContractDetails, { contract }) });
    app.component("UBadge", BadgeStub);

    const html = await renderToString(app);

    expect(html).toContain("run-mock-selected");
    expect(html).toContain("allow-passed-after-retry");
    expect(html).toContain("checkout.desktop@chromium#0::attempt-0");
    expect(html).toContain(`sha256:${"6".repeat(64)}`);
    expect(html).toContain(`sha256:${"7".repeat(64)}`);
    expect(html).toContain(`sha256:${"8".repeat(64)}`);
    expect(html).toContain("first attempt retained for retry history");
    expect(html).toContain("8244");
  });
});

describe("ContractRail", () => {
  it("labels a direct selected run as a subset and surfaces run diagnostics", async () => {
    const run = {
      ...dashboardMockRun,
      coverage: {
        selectionMode: "subset" as const,
        required: 0,
        selected: 1,
        available: 1,
        selectedCaseIds: ["checkout.desktop@chromium#0"],
        availableCaseIds: ["checkout.desktop@chromium#0"],
        requiredCaseIds: [],
      },
      diagnostics: [
        {
          kind: "warning" as const,
          code: "attempt-publication-failed",
          message: "attempt evidence could not be committed",
          blocking: true,
        },
      ],
    };
    const app = createSSRApp({
      render: () =>
        h(ContractRail, {
          run,
          contractsCount: 1,
          contractTree: [],
          query: "",
          "onUpdate:query": () => undefined,
          status: "all",
          "onUpdate:status": () => undefined,
        }),
    });
    for (const component of ["UBadge", "UInput", "USelect", "UTree", "UProgress"]) {
      app.component(component, component === "UBadge" ? BadgeStub : ComponentStub);
    }

    const html = await renderToString(app);

    expect(html).toContain("Selected 1 case");
    expect(html).toContain("subset (full matrix supplied by authority)");
    expect(html).not.toContain("Coverage 1/0");
    expect(html).toContain("attempt-publication-failed");
  });
});

const ButtonStub = defineComponent({
  setup(_props, { slots, attrs }) {
    return () => h("button", attrs, slots.default?.());
  },
});

const SelectStub = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  setup(props) {
    return () =>
      h(
        "ol",
        (props.items as Array<{ label: string }>).map((item) => h("li", item.label)),
      );
  },
});

interface StubTreeItem {
  children?: StubTreeItem[];
}

/** Renders each tree item's leading/label slots, so status dots are observable. */
const TreeStub = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    const render = (item: StubTreeItem): ReturnType<typeof h>[] => [
      h("div", [
        slots["item-leading"]?.({ item, expanded: true }),
        slots["item-label"]?.({ item }),
      ]),
      ...(item.children ?? []).flatMap(render),
    ];
    return () => h("div", (props.items as StubTreeItem[]).flatMap(render));
  },
});

describe("ContractDetails actions", () => {
  async function renderDetails(index: number, inspectedAttemptId?: string) {
    const contract = dashboardMockRun.contracts[index]!;
    const app = createSSRApp({
      render: () => h(ContractDetails, { contract, inspectedAttemptId }),
    });
    app.component("UBadge", BadgeStub);
    app.component("UButton", ButtonStub);
    return renderToString(app);
  }

  it("offers a copyable promote command only for a failed page-baseline contract", async () => {
    const failedPage = await renderDetails(2);
    expect(failedPage).toContain('data-testid="promote-command"');
    expect(failedPage).toContain(
      "framelia baseline promote --key checkout.mobile --target-url http://127.0.0.1:3000/checkout",
    );
    expect(await renderDetails(0)).not.toContain('data-testid="promote-command"');
  });

  it("lets each attempt be shown in the inspector, marking the inspected one", async () => {
    const html = await renderDetails(0, "checkout.desktop@chromium#0::attempt-0");
    const buttons = html.match(/<button[^>]*data-testid="inspect-attempt"[^>]*>[^<]*/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('aria-pressed="true"');
    expect(buttons[0]).toContain("Shown in inspector");
    expect(buttons[1]).toContain('aria-pressed="false"');
  });
});

describe("ContractRail accessibility", () => {
  it("lists All first, labels status dots, and points at real commands", async () => {
    const emptyRun = {
      ...dashboardMockRun,
      contracts: [],
      summary: { total: 0, queued: 0, running: 0, passed: 0, failed: 0, blocked: 0 },
    };
    const app = createSSRApp({
      render: () =>
        h(ContractRail, {
          run: emptyRun,
          contractsCount: 0,
          contractTree: buildContractTree(dashboardMockRun.contracts, "Checkout"),
          query: "",
          "onUpdate:query": () => undefined,
          status: "all",
          "onUpdate:status": () => undefined,
        }),
    });
    app.component("UBadge", BadgeStub);
    app.component("USelect", SelectStub);
    app.component("UTree", TreeStub);
    for (const component of ["UInput", "UProgress"]) app.component(component, ComponentStub);

    const html = await renderToString(app);

    expect(html).toMatch(/<ol[^>]*><li>All<\/li><li>Passed<\/li><li>Masked pass<\/li>/);
    expect(html).toMatch(/role="img" aria-label="Failed"/);
    expect(html).toMatch(/role="img" aria-label="Blocked"/);
    expect(html).toContain("framelia check --all");
    expect(html).not.toContain("framelia verify");
  });
});
