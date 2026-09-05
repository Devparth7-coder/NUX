"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, CheckCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, relativeTime, titleCase } from "@/lib/utils";
import { ApprovalCard } from "@/features/command/approval-card";
import type { ApprovalSummary } from "@/types/api";

export default function ApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<"PENDING" | "ALL">("PENDING");

  const { data, isLoading } = useQuery({
    queryKey: ["approvals", status],
    queryFn: () => api.get<{ approvals: ApprovalSummary[] }>(`/api/approvals${status === "PENDING" ? "?status=PENDING" : ""}`),
    refetchInterval: 10_000,
  });

  const pending = (data?.approvals ?? []).filter((a) => a.status === "PENDING");

  async function approveAll() {
    try {
      for (const approval of pending) {
        await api.post(`/api/approvals/${approval.id}/decide`, { decision: "APPROVED" });
      }
      toast({ tone: "success", title: `Approved ${pending.length} action(s)`, body: "NEXUS resumed the affected runs." });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    } catch (err) {
      toast({ tone: "error", title: "Approval failed", body: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-8 md:px-8">
      <PageHeader
        title="Approvals"
        description="NEXUS prepares actions but does not take them without you. Every request explains what will happen, why it is needed, which tool runs and what data is affected."
        actions={
          pending.length ? (
            <Button variant="primary" size="md" onClick={approveAll}>
              <CheckCheck className="h-3.5 w-3.5" /> Approve all ({pending.length})
            </Button>
          ) : undefined
        }
      />

      <div className="mt-6 flex gap-1.5">
        {(["PENDING", "ALL"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setStatus(option)}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors",
              status === option
                ? "border-accent/40 bg-accent/10 text-[#9dc0ff]"
                : "border-line bg-surface-1 text-mute hover:text-dim hover:border-line-strong",
            )}
          >
            {titleCase(option)}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {isLoading ? (
          <LoadingRows rows={3} />
        ) : data?.approvals?.length ? (
          data.approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onResolved={() => void queryClient.invalidateQueries({ queryKey: ["approvals"] })}
            />
          ))
        ) : (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title="Nothing pending"
              description="When an agent needs permission to write, send or publish, the request appears here."
            />
          </Card>
        )}
      </div>

      {data?.approvals?.length ? (
        <p className="mt-4 text-center text-[11px] text-mute">
          Showing {data.approvals.length} approval(s) · most recent {relativeTime(data.approvals[0].createdAt)}
        </p>
      ) : null}
    </div>
  );
}
