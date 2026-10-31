import { customAlphabet } from "nanoid";

// Alphanumeric only: nanoid's default alphabet includes "-", so an id could begin with one
// and be parsed as a flag by `framelia report|open|dashboard --run <id>`.
const RUN_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RUN_ID_LENGTH = 21;

const generate = customAlphabet(RUN_ID_ALPHABET, RUN_ID_LENGTH);

/** A fresh run id, safe as a `.framelia/runs/<runId>` path segment and as a CLI argument. */
export function createRunId(): string {
  return generate();
}
