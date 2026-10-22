# Good and bad tests

Read by the RED phase before writing a test, and by the orchestrator when verifying it.

## Good

A good test drives the public interface (an exported function, the CLI process, the matcher in a real page) and asserts what the caller observes. It reads like a specification and survives a rewrite of the internals.

```ts
// GOOD: the caller's view of the behaviour, with a known literal
it("reclaims a stale lock whose owner PID is no longer alive", async () => {
  const root = temporaryRoot();
  writeLock(root, 424_242);

  await withAuthoringLock(root, () => {
    const owner = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
    expect(owner.pid).toBe(process.pid);
  });
});
```

- Uses the public interface only: package exports, CLI output and exit code, files the run bundle publishes.
- Describes what happens, not how.
- One behaviour per test (several assertions are fine when they check the same behaviour).
- Swap test: could the implementation be rewritten from scratch and this test still pass? If not, it is coupled to the code.

## Bad: coupled to the implementation

The tell: the test breaks on a refactor although the behaviour did not change.

```ts
// BAD: spies on our own helper and asserts the call
vi.mock("../src/compare/png.ts", { spy: true });
it("reads both image sizes", () => {
  areaGap(baseline, actual);
  expect(readSize).toHaveBeenCalledTimes(2);
});

// GOOD: assert the result the caller gets
it("returns 0% for same-size images", () => {
  const white = makeSolidPng(100, 100, [255, 255, 255, 255]);
  const black = makeSolidPng(100, 100, [0, 0, 0, 255]);
  expect(areaGap(white, black).areaGapPercent).toBe(0);
});
```

- Mocking our own modules (mock only the machine boundary: the Figma HTTP API through an injected `fetch`, the clock).
- Asserting on call counts or order, or on private helpers, when the result is observable.
- Verifying through a side channel instead of the interface: read the run bundle back through the `@framelia/verify/run-bundle` readers rather than parsing a file the readers own, unless the on-disk format itself is the behaviour.

## Bad: tautological

The expected value is computed the way the code computes it, so the test passes by construction and can never disagree with the code.

```ts
// BAD: the code's own canonicalizer produces the expected digest
expect(canonicalJsonDigest(record)).toBe(`sha256:${sha256Hex(canonicalJson(record))}`);

// GOOD: an independent, known literal
expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
```

Expected values come from a literal, a worked example or the acceptance criteria: never from the code under test or a helper it uses.

## Bad: horizontal slicing

Writing all tests first, then all the code. Bulk tests verify imagined behaviour: they test the shape of things, fix the test structure before the implementation is understood, and go insensitive to real changes. Work in vertical slices instead: one test, one minimal implementation, repeat. The first slice is a tracer bullet through the simplest happy path; each next slice responds to what the last one taught you.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd) (`tests.md`, `SKILL.md`).

MIT License. Copyright (c) 2026 Matt Pocock. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
