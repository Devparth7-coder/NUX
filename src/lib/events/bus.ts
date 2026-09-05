import { EventEmitter } from "node:events";
import { log } from "@/lib/logger";

export type NexusEvent = {
  id: string;
  channel: string;          // `run:${id}` | `intent:${id}` | `workspace:${id}`
  type: string;             // RunEventKind or domain event name
  message: string;
  detail?: Record<string, unknown>;
  at: string;
};

class NexusBus {
  private emitter = new EventEmitter();
  private recent = new Map<string, NexusEvent[]>();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish(channel: string, type: string, message: string, detail?: Record<string, unknown>) {
    const event: NexusEvent = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      channel,
      type,
      message,
      detail,
      at: new Date().toISOString(),
    };
    const history = this.recent.get(channel) ?? [];
    history.push(event);
    this.recent.set(channel, history.slice(-200));
    this.emitter.emit(channel, event);
    this.emitter.emit("*", event);
    return event;
  }

  subscribe(channel: string, handler: (e: NexusEvent) => void) {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  history(channel: string, since?: string) {
    const all = this.recent.get(channel) ?? [];
    if (!since) return all;
    const idx = all.findIndex((e) => e.id === since);
    return idx === -1 ? all : all.slice(idx + 1);
  }
}

const globalForBus = globalThis as unknown as { nexusBus?: NexusBus };
export const bus: NexusBus = globalForBus.nexusBus ?? new NexusBus();
if (process.env.NODE_ENV !== "production") globalForBus.nexusBus = bus;

export function publishRunEvent(runId: string, intentId: string | null, type: string, message: string, detail?: Record<string, unknown>) {
  const event = bus.publish(`run:${runId}`, type, message, detail);
  if (intentId) bus.publish(`intent:${intentId}`, type, message, { ...detail, runId });
  log.debug(`run:${runId} ${type} — ${message}`);
  return event;
}
