"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "warning" | "info";

type Toast = { id: string; title: string; body?: string; tone: ToastTone };

type ToastContextValue = {
  toast: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE_STYLES: Record<ToastTone, string> = {
  success: "text-emerald",
  error: "text-red",
  warning: "text-amber",
  info: "text-[#8fbaff]",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((input: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { ...input, id }]);
    setTimeout(() => dismiss(id), 5200);
  }, [dismiss]);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[min(92vw,360px)] flex-col gap-2" role="region" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              className="panel-raised flex items-start gap-3 p-3.5 animate-fade-up"
              role={t.tone === "error" ? "alert" : "status"}
            >
              <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", TONE_STYLES[t.tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{t.title}</p>
                {t.body ? <p className="text-[12px] text-mute mt-0.5 leading-relaxed">{t.body}</p> : null}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-mute hover:text-ink" aria-label="Dismiss notification">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
