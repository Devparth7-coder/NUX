import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  tone,
}: {
  value: number;
  className?: string;
  tone?: "accent" | "success" | "warning" | "danger";
}) {
  const tones = {
    accent: "bg-accent",
    success: "bg-emerald",
    warning: "bg-amber",
    danger: "bg-red",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tones[tone ?? "accent"])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
