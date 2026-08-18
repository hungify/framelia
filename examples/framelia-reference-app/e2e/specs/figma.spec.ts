import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

const contractPath = path.resolve(".framelia/visual-verifications/login/visual-contract.json");
const contractFile = existsSync(contractPath)
  ? (JSON.parse(await fs.readFile(contractPath, "utf8")) as {
      contracts: Array<{
        baseline: { fileKey: string; nodeId: string };
        id: string;
      }>;
    })
  : undefined;
const loginContract = contractFile?.contracts.find((contract) => contract.id === "login.desktop");
const hasFigmaConfig = Boolean(process.env.FIGMA_ACCESS_TOKEN && loginContract);

test("toMatchFigma compares login page with its visual contract", async ({ page }) => {
  test.skip(
    !hasFigmaConfig,
    "Blocked: run pnpm cli:contract:login and provide FIGMA_ACCESS_TOKEN.",
  );
  await page.goto("/login");
  await expect(page).toMatchFigma(loginContract!.baseline.nodeId, {
    fileKey: loginContract!.baseline.fileKey,
    fullPage: true,
    animationPolicy: "freeze",
  });
});
