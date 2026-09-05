"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-[10px] border border-line bg-surface-1 px-3.5 py-2.5 text-[13.5px] text-ink",
        "placeholder:text-mute/70 transition-colors focus:border-accent/50 focus:bg-surface-2 outline-none",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-[10px] border border-line bg-surface-1 px-3.5 py-2.5 text-[13.5px] text-ink",
        "placeholder:text-mute/70 transition-colors focus:border-accent/50 focus:bg-surface-2 outline-none resize-none",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-[11px] font-medium uppercase tracking-[0.08em] text-mute", className)}
      {...props}
    />
  );
}

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "rounded-[10px] border border-line bg-surface-1 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent/50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
