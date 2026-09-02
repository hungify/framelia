// Proves the injected-`test` escape hatch (createFrameliaMatchers) end-to-end under a
// real Playwright runner: an "external consumer" builds its own `expect` by wiring its
// own already-loaded `test`/`expect` in directly, exactly the way a real external
// consumer hitting Playwright's "second @playwright/test instance" crash would --
// without ever importing `@framelia/playwright`'s `.` or `./register` entry points
// (both of which carry their own real @playwright/test import; see their doc comments).
import { expect as baseExpect, test } from "@playwright/test";

import { createFrameliaMatchers } from "../src/create-matchers.ts";

const SIZE = { width: 100, height: 80 };
const HTML = `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(50,80,110)}</style>`;
const DIFFERENT_HTML = `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(200,20,20)}</style>`;

/** The pattern this test exists to prove works: a consumer's own `test`/`expect`,
 *  never framelia's own module-scope import of either. */
const expect = baseExpect.extend(createFrameliaMatchers(test));

test("createFrameliaMatchers(test) wired directly to the caller's own test handle runs a real matcher end-to-end", async ({
  page,
}) => {
  const reference = await page.context().newPage();
  await page.setContent(HTML);
  await reference.setContent(HTML);

  // Passing means runToMatchPage ran to completion through test.info() sourced from
  // this file's own `test`, not a module-scope import inside the package -- the
  // exact call path a real duplicate-instance consumer needs to avoid the crash.
  await expect(page).toMatchPage(reference);

  await reference.setContent(DIFFERENT_HTML);
  await expect(expect(page).toMatchPage(reference)).rejects.toThrow(/pages did not match/);

  await reference.close();
});
