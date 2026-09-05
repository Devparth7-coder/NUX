import { Suspense } from 'react';
import { CommandCenter } from '@/features/command/command-center';
import { getMode } from '@/server/page-data';

export const metadata = { title: 'Command · NEXUS' };

export default function CommandPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-ink-faint">Loading command center…</div>}>
      <CommandCenter mode={getMode()} />
    </Suspense>
  );
}
