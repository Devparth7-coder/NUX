import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "violet" | "cyan";

const TONES: Record<Tone, string> = {
  neutral: "bg-white/[0.05] text-dim border-white/[0.08]",
  accent: "bg-accent/12 text-[#8fbaff] border-accent/25",
  success: "bg-emerald/12 text-emerald border-emerald/25",
  warning: "bg-amber/12 text-amber border-amber/25",
  danger: "bg-red/12 text-red border-red/25",
  violet: "bg-violet/12 text-[#b39dfb] border-violet/25",
  cyan: "bg-cyan/12 text-cyan border-cyan/25",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[10.5px] font-medium tracking-[0.02em] uppercase",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  COMPLETED: "success",
  SUCCESS: "success",
  SUCCEEDED: "success",
  HEALTHY: "success",
  DONE: "success",
  CONNECTED: "success",
  RUNNING: "accent",
  IN_PROGRESS: "accent",
  ACTIVE: "accent",
  PLANNING: "accent",
  QUEUED: "neutral",
  PENDING: "neutral",
  TODO: "neutral",
  WAITING_APPROVAL: "warning",
  AWAITING_APPROVAL: "warning",
  AT_RISK: "warning",
  BLOCKED: "warning",
  FAILED: "danger",
  ERROR: "danger",
  CANCELLED: "neutral",
  PARTIAL: "warning",
  HIGH_IMPACT: "danger",
  EXTERNAL_ACTION: "warning",
  WRITE: "accent",
  READ: "neutral",
};
