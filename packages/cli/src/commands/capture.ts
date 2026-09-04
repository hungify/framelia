import { buildCommand, numberParser } from "@stricli/core";

import { identityParser } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import { emitResult } from "../output.ts";

interface CaptureFlags {
  readonly fileKey: string;
  readonly nodeId: string;
  readonly out: string;
  readonly scale: number | undefined;
  readonly canvasFill: string | undefined;
}

export const captureCommand = buildCommand({
  loader: async () => {
    const { captureCommand: runCaptureCommand } = await import("../internal/capture.ts");
    return async function (this: CliContext, flags: CaptureFlags) {
      const result = await runCaptureCommand(
        {
          fileKey: flags.fileKey,
          nodeId: flags.nodeId,
          out: flags.out,
          scale: flags.scale,
          canvasFill: flags.canvasFill,
        },
        this.runtime,
      );
      emitResult(this, result, result.ok && result.fetched);
    };
  },
  parameters: {
    flags: {
      fileKey: {
        kind: "parsed",
        parse: identityParser,
        brief: "Figma file key",
        placeholder: "key",
      },
      nodeId: { kind: "parsed", parse: identityParser, brief: "Figma node ID", placeholder: "id" },
      out: {
        kind: "parsed",
        parse: identityParser,
        brief: "baseline PNG output",
        placeholder: "path",
      },
      scale: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "Figma image scale",
        placeholder: "number",
      },
      canvasFill: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "canvas fill such as #fff",
        placeholder: "color",
      },
    },
    aliases: { k: "fileKey", n: "nodeId", o: "out", s: "scale", c: "canvasFill" },
  },
  docs: { brief: "Capture a Figma node baseline image." },
});
