import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-14 px-6", className)}>
      {Icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2">
          <Icon className="h-5 w-5 text-mute" />
        </div>
      ) : null}
      <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-[12.5px] text-mute leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-red/25 bg-red/10">
        <span className="text-red text-lg">!</span>
      </div>
      <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      {description ? <p className="mt-1.5 max-w-md text-[12.5px] text-mute leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
