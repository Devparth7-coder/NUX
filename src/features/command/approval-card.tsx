"use client";

import * as React from "react";
import { ShieldAlert, Check, X, Pencil, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { cn, titleCase } from "@/lib/utils";
import type { ApprovalSummary } from "@/types/api";

const LEVEL_COPY: Record<string, { label: string; description: string; className: string }> = {
  READ: { label: "READ", description: "Reads workspace data. No side effects.", className: "text-mute" },
  WRITE: { label: "WRITE", description: "Creates or updates workspace records.", className: "text-accent-bright" },
  EXTERNAL_ACTION: {
    label: "EXTERNAL",
    description: "Reaches an external system and can be visible outside your workspace.",
    className: "text-amber",
  },
  HIGH_IMPACT: {
    label: "HIGH IMPACT",
    description: "Destructive or irreversible. Always requires approval.",
    className: "text-red",
  },
};

export function ApprovalCard({
  approval,
  onResolved,
  queryKey,
}: {
  approval: ApprovalSummary;
  onResolved?: () => void;
  queryKey?: readonly unknown[];
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<null | "approve" | "deny" | "modify">(null);
  const [editing, setEditing] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [modifiedInput, setModifiedInput] = React.useState("");

  const level = LEVEL_COPY[approval.permissionLevel] ?? LEVEL_COPY.WRITE;
  const resolved = approval.status !== "PENDING";

  async function decide(decision: "APPROVED" | "DENIED" | "MODIFIED") {
    setBusy(decision === "APPROVED" ? "approve" : decision === "DENIED" ? "deny" : "modify");
    try {
      let parsedInput: Record<string, unknown> | null = null;
      if (decision === "MODIFIED") {
        try {
          parsedInput = modifiedInput ? (JSON.parse(modifiedInput) as Record<string, unknown>) : null;
        } catch {
          toast({ tone: "error", title: "Invalid JSON", body: "The modified input must be valid JSON." });
          setBusy(null);
          return;
        }
      }
      await api.post(`/api/approvals/${approval.id}/decide`, {
        decision,
        note: note || null,
        modifiedInput: parsedInput,
      });
      toast({
        tone: decision === "DENIED" ? "warning" : "success",
        title: decision === "DENIED" ? "Action denied" : "Approved — execution resumed",
        body: decision === "DENIED" ? "NEXUS skipped this action." : "NEXUS is continuing the run.",
      });
      onResolved?.();
    } catch (err) {
      toast({ tone: "error", title: "Decision failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      setEditing(false);
    }
  }

  return (
    <div
      className={cn(
        "panel-raised p-4 transition-colors",
        resolved ? "opacity-70" : "border-amber/25",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border",
            resolved ? "border-emerald/25 bg-emerald/10" : "border-amber/30 bg-amber/10",
          )}
        >
          <ShieldAlert className={cn("h-4 w-4", resolved ? "text-emerald" : "text-amber")} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13.5px] font-medium text-ink">{approval.title}</h4>
            <Badge tone={approval.permissionLevel === "HIGH_IMPACT" ? "danger" : approval.permissionLevel === "EXTERNAL_ACTION" ? "warning" : "accent"}>
              {level.label}
            </Badge>
            {resolved ? (
              <Badge tone={approval.status === "DENIED" ? "danger" : "success"}>{titleCase(approval.status)}</Badge>
            ) : (
              <Badge tone="warning">Needs your decision</Badge>
            )}
          </div>

          <dl className="mt-3 space-y-2 text-[12.5px]">
            <div className="grid gap-1 sm:grid-cols-[92px_1fr]">
              <dt className="text-mute">What happens</dt>
              <dd className="text-dim">{approval.whatHappens}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[92px_1fr]">
              <dt className="text-mute">Why needed</dt>
              <dd className="text-dim">{approval.whyNeeded}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[92px_1fr]">
              <dt className="text-mute">Tool</dt>
              <dd className="font-mono text-[11.5px] text-dim">{approval.toolKey}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[92px_1fr]">
              <dt className="text-mute">Data affected</dt>
              <dd className="text-dim">
                <pre className="overflow-x-auto rounded-lg border border-line bg-surface-1 p-2 font-mono text-[11px] leading-relaxed text-dim">
                  {JSON.stringify(approval.affectedData, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>

          {!resolved ? (
            <div className="mt-4 space-y-3">
              {editing ? (
                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-[0.08em] text-mute">Modified input (JSON)</label>
                  <textarea
                    value={modifiedInput || JSON.stringify((approval as unknown as { payload?: { input?: unknown } }).payload?.input ?? {}, null, 2)}
                    onChange={(e) => setModifiedInput(e.target.value)}
                    rows={6}
                    className="w-full rounded-[10px] border border-line bg-surface-1 p-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent/50"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Decision note (optional)"
                  className="w-full rounded-[10px] border border-line bg-surface-1 px-3 py-2 text-[12.5px] text-ink placeholder:text-mute/70 outline-none focus:border-accent/50"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => decide("APPROVED")} loading={busy === "approve"}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => decide("DENIED")} loading={busy === "deny"}>
                    <X className="h-3.5 w-3.5" /> Deny
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!editing) {
                        setEditing(true);
                        return;
                      }
                      void decide("MODIFIED");
                    }}
                    loading={busy === "modify"}
                  >
                    <Pencil className="h-3.5 w-3.5" /> {editing ? "Approve modified" : "Modify"}
                  </Button>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-mute">
                    <ExternalLink className="h-3 w-3" />
                    {level.description}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11.5px] text-mute">
              {approval.status === "DENIED"
                ? "Denied — NEXUS skipped this action and preserved the rest of the plan."
                : "Approved — the orchestrator resumed and executed this action."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
