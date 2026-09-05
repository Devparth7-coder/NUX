import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
      {Icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2/70">
          <Icon className="h-5 w-5 text-ink-faint" />
        </div>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const TONES = {
  info: { icon: Info, cls: 'border-accent/25 bg-accent/10 text-accent-soft' },
  success: { icon: CheckCircle2, cls: 'border-good/25 bg-good/10 text-good' },
  warning: { icon: AlertTriangle, cls: 'border-warn/25 bg-warn/10 text-warn' },
  error: { icon: XCircle, cls: 'border-bad/25 bg-bad/10 text-bad' },
} as const;

export function Callout({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, cls } = TONES[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1', 'text-ink-muted')}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Progress({ value, className, tone }: { value: number; className?: string; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-bad' : 'bg-accent';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-700 ease-out', toneClass)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-line bg-surface-2 px-1.5 font-mono text-2xs text-ink-faint">
      {children}
    </kbd>
  );
}

/** Deterministic dot-grid avatar — no external image dependencies. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold', className)}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 26%), hsl(${(hue + 40) % 360} 55% 18%))`,
        color: `hsl(${hue} 90% 88%)`,
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {initials}
    </div>
  );
}
