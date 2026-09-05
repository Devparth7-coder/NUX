import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  detail?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink-faint',
          )}
        />
        <span className="label">{label}</span>
      </div>
      <p className="mt-2.5 text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink">{value}</p>
      {detail ? <p className="mt-1.5 text-2xs text-ink-faint">{detail}</p> : null}
    </Card>
  );
}
