import { renderToString } from "@vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";

import ContractDetails from "../components/ContractDetails.vue";
import { dashboardMockRun } from "../mocks/dashboard";

const BadgeStub = defineComponent({
  setup(_props, { slots }) {
    return () => h("span", slots.default?.());
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
