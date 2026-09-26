import type { AuthoredContract } from "@framelia/contracts/workflow";
import { expect, type ToMatchFigmaOptions } from "@framelia/playwright";
import type { ResolvedProjectPolicy } from "@framelia/playwright/project-policy";
import type { CanonicalJsonValue } from "@framelia/verify/project-policy";
import type { Page } from "@playwright/test";

export async function checkMatcherTypes(page: Page, reference: Page): Promise<void> {
  const options: ToMatchFigmaOptions = { animationPolicy: "freeze", fontPolicy: "required" };
  await expect(page).toMatchFigma("1:2", options);
  await expect(page).toMatchPage(reference);
  // @ts-expect-error The published declarations must reject a URL in place of a Page.
  await expect(page).toMatchPage("https://example.com");
  // @ts-expect-error The published declarations must preserve the required node ID.
  await expect(page).toMatchFigma();
}

export const workflowRecordTypes = {
  contract: null as unknown as AuthoredContract,
  policy: null as unknown as ResolvedProjectPolicy,
  canonical: null as unknown as CanonicalJsonValue,
};
