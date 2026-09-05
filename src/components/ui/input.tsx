import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-line bg-surface-2/60 px-3 text-sm text-ink placeholder:text-ink-faint transition-colors',
        'hover:border-line-strong focus:border-accent/50 focus:bg-surface-2 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors',
        'hover:border-line-strong focus:border-accent/50 focus:bg-surface-2 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-line bg-surface-2/60 px-3 text-sm text-ink transition-colors hover:border-line-strong focus:border-accent/50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
