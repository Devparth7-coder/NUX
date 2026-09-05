'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_8px_24px_-10px_rgba(61,126,255,0.9)] hover:bg-accent-soft hover:shadow-[0_1px_0_0_rgba(255,255,255,0.22)_inset,0_10px_30px_-8px_rgba(61,126,255,1)]',
        secondary: 'bg-surface-3/80 text-ink border border-line hover:bg-surface-4/80 hover:border-line-strong',
        ghost: 'text-ink-muted hover:text-ink hover:bg-white/[0.05]',
        outline: 'border border-line-strong text-ink hover:bg-white/[0.04]',
        danger: 'bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25',
        success: 'bg-good/15 text-good border border-good/30 hover:bg-good/25',
        link: 'text-accent-soft underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-[15px]',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
