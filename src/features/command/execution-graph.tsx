"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { AgentRunSummary } from "@/types/api";

export type GraphNode = {
  id: string;
  agent: string;
  title: string;
  dependsOn: string[];
  status: string;
};

const AGENT_COLOR: Record<string, string> = {
  planning: "#60A5FA",
  research: "#818CF8",
  knowledge: "#34D399",
  execution: "#F59E0B",
  review: "#F472B6",
  creative: "#C084FC",
  analyst: "#22D3EE",
  orchestrator: "#8B5CF6",
};

/**
 * Execution graph. Node animation is driven entirely by persisted run status —
 * a node only animates while its agent is genuinely running.
 */
export function ExecutionGraph({
  nodes,
  runs,
  className,
}: {
  nodes: GraphNode[];
  runs: AgentRunSummary[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const statusByKey = React.useMemo(() => {
    const map = new Map<string, AgentRunSummary>();
    for (const run of runs) map.set(run.key, run);
    return map;
  }, [runs]);

  const levels = React.useMemo(() => {
    const resolved = new Set<string>();
    const remaining = [...nodes];
    const out: GraphNode[][] = [];
    let guard = 0;
    while (remaining.length && guard++ < 20) {
      const level = remaining.filter((n) => n.dependsOn.every((d) => resolved.has(d)));
      if (!level.length) break;
      level.forEach((n) => resolved.add(n.id));
      out.push(level);
      for (const n of level) remaining.splice(remaining.indexOf(n), 1);
    }
    if (remaining.length) out.push(remaining);
    return out;
  }, [nodes]);

  return (
    <div className={cn("relative overflow-x-auto", className)}>
      <div className="flex min-w-max items-stretch gap-4 md:gap-8 px-1 py-3">
        {levels.map((level, levelIndex) => (
          <div key={levelIndex} className="flex flex-col justify-center gap-3">
            {level.map((node) => {
              const run = statusByKey.get(node.agent);
              const status = (run?.status ?? node.status ?? "PENDING") as string;
              const color = AGENT_COLOR[node.agent] ?? "#64748B";
              const active = status === "RUNNING" || status === "PLANNING" || status === "QUEUED";
              const waiting = status === "WAITING_APPROVAL";
              const done = status === "COMPLETED";
              const failed = status === "FAILED" || status === "CANCELLED";

              return (
                <div key={node.id} className="relative">
                  {levelIndex > 0 ? (
                    <span className="absolute -left-4 md:-left-8 top-1/2 h-px w-4 md:w-8 -translate-y-1/2 bg-line-strong" aria-hidden />
                  ) : null}

                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: levelIndex * 0.05 }}
                    className={cn(
                      "group relative flex w-[188px] items-center gap-3 rounded-[12px] border px-3 py-2.5",
                      "bg-surface-2 transition-colors",
                      done && "border-emerald/25",
                      waiting && "border-amber/40",
                      failed && "border-red/35",
                      !done && !waiting && !failed && active && "border-accent/40",
                      !done && !waiting && !failed && !active && "border-line",
                    )}
                    style={{
                      boxShadow: active
                        ? `0 0 0 1px ${color}33, 0 14px 40px -22px ${color}aa`
                        : done
                          ? `0 10px 30px -24px ${color}66`
                          : undefined,
                    }}
                    role="status"
                    aria-label={`${node.title}: ${status.toLowerCase().replace(/_/g, " ")}`}
                  >
                    {active ? (
                      <span className="absolute inset-0 overflow-hidden rounded-[12px]" aria-hidden>
                        <span className="absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent)] animate-sweep" />
                      </span>
                    ) : null}

                    <span
                      className={cn("relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border")}
                      style={{
                        borderColor: `${color}55`,
                        background: `${color}18`,
                      }}
                    >
                      {active ? (
                        <span className="absolute inset-0 rounded-[9px] border animate-ring" style={{ borderColor: color }} aria-hidden />
                      ) : null}
                      <span className="text-[11px] font-semibold" style={{ color }}>
                        {node.agent.slice(0, 2).toUpperCase()}
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-ink">{node.title}</span>
                      <span
                        className={cn(
                          "mt-0.5 block text-[10.5px] uppercase tracking-[0.08em]",
                          done ? "text-emerald" : waiting ? "text-amber" : failed ? "text-red" : active ? "text-accent-bright" : "text-mute",
                        )}
                      >
                        {status.replace(/_/g, " ")}
                      </span>
                    </span>
                  </motion.div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
