/**
 * Project health model (§14).
 *
 * Deterministic computation from real task/deadline state:
 *   BLOCKED   — an open task is blocked, or progress stalled with overdue work
 *   AT_RISK   — overdue tasks, or deadline pressure with incomplete work
 *   COMPLETED — every task done
 *   HEALTHY   — otherwise
 */

import { prisma } from '../../lib/db';

export interface ProjectHealth {
  health: 'HEALTHY' | 'AT_RISK' | 'BLOCKED' | 'COMPLETED';
  healthScore: number;
  progress: number;
  openTasks: number;
  completedTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  deadlineDays: number | null;
  blockers: string[];
  risks: string[];
}

export async function computeProjectHealth(projectId: string, persist = false): Promise<ProjectHealth> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { tasks: { select: { id: true, title: true, status: true, deadline: true } } },
  });
  if (!project) {
    return {
      health: 'HEALTHY', healthScore: 0, progress: 0, openTasks: 0, completedTasks: 0,
      overdueTasks: 0, blockedTasks: 0, deadlineDays: null, blockers: ['Project not found'], risks: [],
    };
  }

  const now = Date.now();
  const tasks = project.tasks;
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'DONE').length;
  const blocked = tasks.filter((t) => t.status === 'BLOCKED');
  const overdue = tasks.filter((t) => t.deadline && t.deadline.getTime() < now && t.status !== 'DONE');

  const progress = total ? Math.round((completed / total) * 100) : project.progress;
  const deadlineDays = project.deadline
    ? Math.round((project.deadline.getTime() - now) / 86_400_000)
    : null;

  const blockers: string[] = [];
  const risks: string[] = [];

  if (blocked.length) blockers.push(...blocked.slice(0, 4).map((t) => `Blocked task: ${t.title}`));
  if (overdue.length) risks.push(...overdue.slice(0, 4).map((t) => `Overdue: ${t.title}`));
  if (deadlineDays !== null) {
    if (deadlineDays < 0) risks.push(`Deadline passed ${Math.abs(deadlineDays)} day(s) ago`);
    else if (deadlineDays <= 2 && progress < 90) risks.push(`Deadline in ${deadlineDays} day(s) with ${progress}% complete`);
    else if (deadlineDays <= 7 && progress < 60) risks.push(`Deadline in ${deadlineDays} day(s) with only ${progress}% complete`);
  }
  if (total === 0) risks.push('No tasks defined for this project');

  let health: ProjectHealth['health'] = 'HEALTHY';
  if (total > 0 && completed === total) health = 'COMPLETED';
  else if (blocked.length > 0) health = 'BLOCKED';
  else if (overdue.length > 0 || (deadlineDays !== null && deadlineDays <= 3 && progress < 80)) health = 'AT_RISK';

  let healthScore = 100;
  healthScore -= overdue.length * 12;
  healthScore -= blocked.length * 18;
  if (deadlineDays !== null && deadlineDays < 0) healthScore -= 25;
  else if (deadlineDays !== null && deadlineDays <= 3 && progress < 80) healthScore -= 15;
  if (total === 0) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  const result: ProjectHealth = {
    health,
    healthScore,
    progress,
    openTasks: total - completed,
    completedTasks: completed,
    overdueTasks: overdue.length,
    blockedTasks: blocked.length,
    deadlineDays,
    blockers,
    risks,
  };

  if (persist) {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        health: result.health,
        healthScore: result.healthScore,
        progress: result.progress,
        status:
          result.health === 'COMPLETED'
            ? 'COMPLETED'
            : result.health === 'BLOCKED'
              ? 'BLOCKED'
              : result.health === 'AT_RISK'
                ? 'AT_RISK'
                : 'ACTIVE',
      },
    });
  }

  return result;
}
