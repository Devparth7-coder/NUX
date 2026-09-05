"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeRunEvents, type LiveEvent } from "@/lib/api-client";

/**
 * Streams execution events for a run and invalidates the queries that render
 * it, so the UI reflects real backend state rather than optimistic guesses.
 */
export function useLiveRun(params: { runId?: string | null; intentId?: string | null; enabled?: boolean }) {
  const queryClient = useQueryClient();
  const [events, setEvents] = React.useState<LiveEvent[]>([]);
  const [connected, setConnected] = React.useState(false);
  const { runId, intentId, enabled = true } = params;

  React.useEffect(() => {
    if (!enabled || (!runId && !intentId)) return;
    setConnected(false);
    const close = subscribeRunEvents({ runId, intentId }, {
      onEvent: (event) => {
        setConnected(true);
        setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event].slice(-300)));
        void queryClient.invalidateQueries({ queryKey: ["intent", intentId] });
        void queryClient.invalidateQueries({ queryKey: ["run", runId] });
        void queryClient.invalidateQueries({ queryKey: ["approvals"] });
        void queryClient.invalidateQueries({ queryKey: ["activity"] });
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        if (event.type === "RESULT_READY") {
          void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      },
      onError: () => setConnected(false),
    });
    return close;
  }, [runId, intentId, enabled, queryClient]);

  return { events, connected, reset: () => setEvents([]) };
}
