import { Suspense } from 'react';
import { ProjectsView } from '@/features/projects/projects-view';

export const metadata = { title: 'Projects · NEXUS' };

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-ink-faint">Loading projects…</div>}>
      <ProjectsView />
    </Suspense>
  );
}
