"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, FileText, Lightbulb, Download, ArrowRight, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration } from "@/lib/utils";
import type { RunResult } from "@/types/api";

export function ResultPanel({
  result,
  intentId,
  runId,
}: {
  result: RunResult;
  intentId: string;
  runId: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="panel-raised overflow-hidden"
    >
      <div className="relative border-b border-line px-6 py-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(59,130,246,0.14),transparent_55%)]" />
        <div className="relative">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-accent-bright">Result</p>
          <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-gradient">{result.headline}</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-dim">{result.summary}</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Metric label="Tasks" value={String(result.tasks.total)} detail={`${result.tasks.open} open · ${result.tasks.completed} done`} />
            <Metric label="Recommendations" value={String(result.recommendations.length)} detail="From validation" />
            <Metric
              label="Approvals"
              value={String(result.approvals.total)}
              detail={`${result.approvals.approved} approved · ${result.approvals.denied} denied`}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link href={`/runs/${runId}`}>
              <Button variant="primary" size="md">
                Review plan <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            {result.artifacts[0] ? (
              <a href={`/api/artifacts/${result.artifacts[0].id}/download`} download>
                <Button variant="secondary" size="md">
                  <Download className="h-3.5 w-3.5" /> Download plan
                </Button>
              </a>
            ) : null}
            <Link href={`/projects`}>
              <Button variant="ghost" size="md">
                Open projects
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        {/* Plan */}
        <section>
          <SectionTitle icon={CheckCircle2} title="Plan" />
          <ol className="mt-3 space-y-1.5">
            {result.tasks.titles.map((title, index) => (
              <li key={title + index} className="flex items-start gap-2.5 text-[12.5px] text-dim">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[9.5px] font-mono text-mute">
                  {index + 1}
                </span>
                {title}
              </li>
            ))}
          </ol>

          {result.memories.length ? (
            <div className="mt-5">
              <SectionTitle icon={Brain} title="Remembered" />
              <ul className="mt-2 space-y-1.5">
                {result.memories.map((memory) => (
                  <li key={memory} className="flex items-start gap-2 text-[12px] text-mute">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet" />
                    {memory}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* Validation + recommendations */}
        <section>
          <SectionTitle icon={AlertTriangle} title="Validation & recommendations" />
          <div className="mt-3 space-y-2">
            {result.checks.map((check) => (
              <div key={check.name} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    check.status === "pass" ? "bg-emerald" : check.status === "fail" ? "bg-red" : "bg-amber",
                  )}
                />
                <div>
                  <p className="text-[12.5px] text-dim">{check.name}</p>
                  <p className="text-[11.5px] text-mute">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {result.recommendations.length ? (
            <ul className="mt-4 space-y-2">
              {result.recommendations.map((rec) => (
                <li key={rec.title} className="rounded-[10px] border border-line bg-surface-1 p-3">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5 text-amber" />
                    <span className="text-[12.5px] font-medium text-ink">{rec.title}</span>
                    <Badge tone={rec.severity === "high" ? "danger" : "warning"} className="ml-auto">
                      {rec.severity}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-mute">{rec.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {/* Evidence */}
      {result.findings.length ? (
        <div className="border-t border-line px-6 py-5">
          <SectionTitle icon={FileText} title="Evidence" />
          <ul className="mt-3 space-y-2">
            {result.findings.map((finding, index) => (
              <li key={index} className="rounded-[10px] border border-line bg-surface-1 p-3">
                <p className="text-[12.5px] leading-relaxed text-dim">{finding.claim}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-mute">
                  <span>{finding.source}</span>
                  <span className="text-mute/50">·</span>
                  <span>confidence {finding.confidence.toFixed(2)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-1/40 px-6 py-3 text-[11px] text-mute">
        <span>{result.agentRuns} agents</span>
        <span className="text-mute/50">·</span>
        <span>{result.toolCalls} tool calls</span>
        <span className="text-mute/50">·</span>
        <span>{formatDuration(result.durationMs)}</span>
        <span className="text-mute/50">·</span>
        <span>intent {intentId.slice(0, 8)}</span>
      </div>
    </motion.div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface-1/70 px-4 py-3">
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-mute">{label}</p>
      <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-ink">{value}</p>
      <p className="text-[11px] text-mute">{detail}</p>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-mute" />
      <h3 className="text-[12px] font-medium uppercase tracking-[0.1em] text-mute">{title}</h3>
    </div>
  );
}
