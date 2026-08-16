import * as z from "zod";

/** Shared shape for selectors, names, and other required identifier-like strings. */
export const nonEmptyTrimmed = z.string().trim().min(1);

export const httpUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: "must use http or https",
});
