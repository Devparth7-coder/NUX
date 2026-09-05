import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { computeProjectHealth } from '@/server/services/project-health';
import { ProjectWorkspace } from '@/features/projects/project-workspace';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();

  const project = await prisma.project.findFirst({
    where: { id, workspaceId: user.workspaceId },
    include: {
      tasks: { orderBy: [{ status: 'asc' }, { deadline: 'asc' }] },
      documents: { orderBy: { updatedAt: 'desc' } },
      knowledge: { orderBy: { updatedAt: 'desc' }, take: 60 },
      milestones: { orderBy: { order: 'asc' } },
      artifacts: { orderBy: { createdAt: 'desc' }, take: 20 },
      activities: { orderBy: { createdAt: 'desc' }, take: 40 },
      agentRuns: { orderBy: { createdAt: 'desc' }, take: 12, include: { agent: { select: { name: true, key: true } } } },
    },
  });
  if (!project) notFound();

  const [relations, health] = await Promise.all([
    prisma.knowledgeRelation.findMany({ where: { from: { projectId: id } } }),
    computeProjectHealth(id, true),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/projects" className="flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="text-[13px] text-ink">{project.name}</span>
        <Badge
          variant={
            health.health === 'HEALTHY' ? 'good' : health.health === 'BLOCKED' ? 'bad' : health.health === 'AT_RISK' ? 'warn' : 'default'
          }
          className="ml-auto"
        >
          {health.health.replace('_', ' ')}
        </Badge>
        <Link
          href={`/command?q=${encodeURIComponent(`Prepare the launch plan for ${project.name}`)}`}
          className="inline-flex h-8 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-soft"
        >
          <Sparkles className="h-3.5 w-3.5" /> Run NEXUS on this project
        </Link>
      </div>

      <ProjectWorkspace
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          objective: project.objective,
          summary: project.summary,
          status: project.status,
          progress: project.progress,
          deadline: project.deadline?.toISOString() ?? null,
          priority: project.priority,
        }}
        health={health}
        tasks={project.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          deadline: t.deadline?.toISOString() ?? null,
          assignee: t.assignee,
          source: t.source,
          createdByAgent: t.createdByAgent,
        }))}
        documents={project.documents.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          chunkCount: d.chunkCount,
          wordCount: d.wordCount,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        knowledge={project.knowledge.map((k) => ({ id: k.id, title: k.title, type: k.type, content: k.content, confidence: k.confidence }))}
        relations={relations.map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, type: r.type, weight: r.weight }))}
        milestones={project.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          status: m.status,
          dueDate: m.dueDate?.toISOString() ?? null,
        }))}
        artifacts={project.artifacts.map((a) => ({ id: a.id, title: a.title, type: a.type, createdAt: a.createdAt.toISOString() }))}
        activities={project.activities.map((a) => ({
          id: a.id,
          type: a.type,
          action: a.action,
          summary: a.summary,
          severity: a.severity,
          createdAt: a.createdAt.toISOString(),
        }))}
        runs={project.agentRuns.map((r) => ({
          id: r.id,
          status: r.status,
          agent: r.agent,
          durationMs: r.durationMs,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
