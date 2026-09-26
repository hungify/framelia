import { renderToString } from "@vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";

import ContractDetails from "../components/ContractDetails.vue";
import ContractRail from "../components/ContractRail.vue";
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
