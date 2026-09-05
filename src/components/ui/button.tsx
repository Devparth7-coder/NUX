"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[#3b82f6] text-white hover:bg-[#4b8ef7] shadow-[0_10px_30px_-14px_rgba(59,130,246,0.8)] border border-[#5b9dff]/40",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 border border-line",
  ghost: "text-dim hover:text-ink hover:bg-white/5 border border-transparent",
  outline: "border border-line-strong text-ink hover:bg-white/5",
  danger: "bg-red/90 text-white hover:bg-red border border-red/50",
  subtle: "bg-white/[0.04] text-dim hover:text-ink hover:bg-white/[0.07] border border-line",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px] rounded-lg gap-1.5",
  md: "h-9.5 px-4 text-[13px] rounded-[10px] gap-2",
  lg: "h-12 px-6 text-[14.5px] rounded-xl gap-2.5",
  icon: "h-9 w-9 rounded-[10px] justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center font-medium transition-all duration-150 select-none",
        "disabled:opacity-45 disabled:pointer-events-none active:translate-y-[0.5px]",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      ) : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
