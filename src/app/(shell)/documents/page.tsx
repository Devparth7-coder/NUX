import { Suspense } from 'react';
import { DocumentsView } from '@/features/documents/documents-view';
export const metadata = { title: 'Documents · NEXUS' };
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ upload?: string }> }) {
  const params = await searchParams;
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-ink-faint">Loading documents…</div>}>
      <DocumentsView autoUpload={params.upload === '1'} />
    </Suspense>
  );
}
