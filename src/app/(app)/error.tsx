"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("[nexus:client-error]", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-16">
      <Card className="p-8">
        <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-red/25 bg-red/10">
          <AlertTriangle className="h-5 w-5 text-red" />
        </div>
        <h1 className="text-center text-[18px] font-semibold text-ink">Something failed in the interface</h1>
        <p className="mx-auto mt-2 max-w-lg text-center text-[12.5px] leading-relaxed text-mute">
          NEXUS records every failure rather than hiding it. Your workspace state is intact — the run records,
          approvals and artifacts below the surface are safe.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-[10px] border border-line bg-surface-1 p-3 font-mono text-[11px] text-red/90">
          {error.message}
          {error.digest ? `\ndigest: ${error.digest}` : ""}
        </pre>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </Button>
          <Link href="/activity">
            <Button variant="secondary" size="md">
              Inspect activity
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
