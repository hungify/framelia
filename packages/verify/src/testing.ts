/**
 * PNG fixtures for downstream test suites. Published so `@framelia/playwright`
 * can build deterministic images without reaching into the compare internals,
 * and named so it is obvious this is not production surface.
 */

export { makeSolidPng } from "./compare/png.ts";
