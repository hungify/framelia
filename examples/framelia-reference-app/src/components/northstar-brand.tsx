import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

export function NorthstarBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn("inline-flex items-center gap-2.5", compact && "gap-2")}
      aria-label="Framelia"
    >
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-[#2463eb] text-sm font-bold text-white">
        F
      </span>
      <span
        className={cn(
          "text-sm font-semibold tracking-[-0.35px] text-[#0f1729]",
          compact && "hidden sm:inline",
        )}
      >
        Framelia
      </span>
    </div>
  );
}

export function SignalDot({
  tone = "mint",
  children,
}: {
  tone?: "mint" | "coral";
  children?: ReactNode;
}) {
  return (
    <span className={cn("signal-dot", tone === "coral" ? "signal-dot-coral" : "signal-dot-mint")}>
      {children}
    </span>
  );
}
