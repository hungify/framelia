import { writeFileSync } from "node:fs";

import FrameliaReporter from "@framelia/playwright/reporter";
import type { FullResult } from "@playwright/test/reporter";

// A consumer-owned reporter extension exercises the public reporter's runtime
// dependency resolution. Missing optional peers must not pass via a logged error.
export default class ConsumerReporter extends FrameliaReporter {
  constructor() {
    super({ projectRoot: process.cwd(), port: 0 });
  }

  override async onEnd(result: FullResult): Promise<void> {
    try {
      const url = await this.dashboardUrl();
      if (!url) throw new Error("The installed reporter did not start its dashboard.");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}.`);
      writeFileSync("reporter-ready.json", JSON.stringify({ status: response.status }));
    } finally {
      await super.onEnd(result);
    }
  }
}
