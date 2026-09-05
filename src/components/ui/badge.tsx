import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-2xs font-medium tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-line bg-white/[0.04] text-ink-muted',
        accent: 'border-accent/30 bg-accent/12 text-accent-soft',
        violet: 'border-violet/30 bg-violet/12 text-violet-soft',
        good: 'border-good/30 bg-good/12 text-good',
        warn: 'border-warn/30 bg-warn/12 text-warn',
        bad: 'border-bad/30 bg-bad/12 text-bad',
        outline: 'border-line-strong text-ink-faint',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export const STATUS_TONE: Record<string, 'default' | 'accent' | 'good' | 'warn' | 'bad' | 'violet'> = {
  COMPLETED: 'good',
  DONE: 'good',
  INDEXED: 'good',
  ACTIVE: 'accent',
  RUNNING: 'accent',
  IN_PROGRESS: 'accent',
  HEALTHY: 'good',
  CONNECTED: 'good',
  QUEUED: 'default',
  PENDING: 'warn',
  WAITING_APPROVAL: 'warn',
  WAITING: 'warn',
  TODO: 'default',
  DRAFT: 'default',
  BLOCKED: 'bad',
  BLOCKER: 'bad',
  FAILED: 'bad',
  AT_RISK: 'warn',
  CANCELLED: 'default',
  DISCONNECTED: 'default',
  APPROVED: 'good',
  DENIED: 'bad',
  MODIFIED: 'violet',
};
