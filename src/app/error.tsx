"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("[nexus:fatal]", error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-surface-1 p-7 text-center">
        <h1 className="text-[17px] font-semibold text-ink">NEXUS failed to start</h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
          {error.message || "An unrecoverable error occurred."}
        </p>
        <Button variant="primary" size="md" className="mt-5" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
