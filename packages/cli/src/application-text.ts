import { text_en, type ApplicationText } from "@stricli/core";

function formatException(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

export const applicationText: ApplicationText = {
  ...text_en,
  formatException,
  exceptionWhileRunningCommand(exc: unknown): string {
    return formatException(exc);
  },
};
