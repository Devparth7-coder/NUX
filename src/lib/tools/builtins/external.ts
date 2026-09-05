import { z } from 'zod';
import { prisma } from '../../db';
import type { AnyTool, ToolContext } from '../types';
import { blocked } from '../types';

/**
 * External-action tools.
 *
 * These are wired to real APIs. When the corresponding integration is not
 * connected, they report BLOCKED with an explicit reason instead of pretending
 * the action happened. The permission engine stops them for approval first, so
 * the user always sees what is about to leave the workspace.
 */

async function integrationStatus(ctx: ToolContext, key: string) {
  const record = await prisma.integration.findUnique({
    where: { userId_key: { userId: ctx.userId, key } },
  });
  return record?.status === 'CONNECTED' ? record : null;
}

export const githubRepository: AnyTool = {
  key: 'github.repository',
  name: 'Inspect GitHub repository',
  description: 'Read repository metadata from the GitHub API (requires a connected GitHub account with a token).',
  category: 'GITHUB',
  permission: 'READ',
  requiresIntegration: 'github',
  timeoutMs: 25000,
  schema: z.object({ owner: z.string(), repo: z.string() }),
  async handler(args, ctx) {
    const integration = await integrationStatus(ctx, 'github');
    if (!integration) return blocked('GitHub is not connected. Connect it in Settings → Integrations.', 'github');
    const token = process.env.GITHUB_TOKEN ?? '';
    if (!token) return blocked('GITHUB_TOKEN is not configured on the server.', 'github');
    const res = await fetch(`https://api.github.com/repos/${args.owner}/${args.repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { error: `GitHub API responded ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    return {
      fullName: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      openIssues: data.open_issues_count,
      defaultBranch: data.default_branch,
      url: data.html_url,
    };
  },
};

export const githubIssueCreate: AnyTool = {
  key: 'github.issue.create',
  name: 'Create GitHub issue',
  description: 'Open an issue in a GitHub repository.',
  category: 'GITHUB',
  permission: 'EXTERNAL_ACTION',
  requiresIntegration: 'github',
  timeoutMs: 25000,
  schema: z.object({ owner: z.string(), repo: z.string(), title: z.string(), body: z.string().default('') }),
  async handler(args, ctx) {
    const integration = await integrationStatus(ctx, 'github');
    if (!integration) return blocked('GitHub is not connected. Connect it in Settings → Integrations.', 'github');
    const token = process.env.GITHUB_TOKEN ?? '';
    if (!token) return blocked('GITHUB_TOKEN is not configured on the server.', 'github');
    const res = await fetch(`https://api.github.com/repos/${args.owner}/${args.repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ title: args.title, body: args.body }),
    });
    if (!res.ok) return { error: `GitHub API responded ${res.status}: ${(await res.text()).slice(0, 300)}` };
    const data = (await res.json()) as { number: number; html_url: string; title: string };
    return { created: true, number: data.number, url: data.html_url, title: data.title };
  },
};

export const calendarCreate: AnyTool = {
  key: 'calendar.create',
  name: 'Create calendar event',
  description: 'Create a real event record in the workspace calendar. Syncs to Google Calendar when connected.',
  category: 'CALENDAR',
  permission: 'EXTERNAL_ACTION',
  timeoutMs: 20000,
  schema: z.object({
    title: z.string().min(2),
    description: z.string().default(''),
    startsAt: z.string(),
    endsAt: z.string().optional(),
    attendees: z.array(z.string()).default([]),
  }),
  async handler(args, ctx) {
    const startsAt = new Date(args.startsAt);
    if (Number.isNaN(startsAt.getTime())) return { error: 'Invalid start date.' };
    const integration = await integrationStatus(ctx, 'google_calendar');
    const event = await prisma.calendarEvent.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        projectId: ctx.projectId ?? null,
        runId: ctx.runId ?? null,
        title: args.title,
        description: args.description,
        startsAt,
        endsAt: args.endsAt ? new Date(args.endsAt) : null,
        attendees: JSON.stringify(args.attendees),
        syncStatus: integration ? 'SYNCED' : 'NOT_CONNECTED',
      },
    });
    return {
      created: true,
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      syncStatus: event.syncStatus,
      note: integration
        ? 'Event stored and queued for Google Calendar sync.'
        : 'Event stored locally. Connect Google Calendar in Settings → Integrations to sync it.',
    };
  },
};

export const emailDraft: AnyTool = {
  key: 'email.draft',
  name: 'Draft email',
  description: 'Create a real email draft in the workspace. Sending requires the Gmail integration.',
  category: 'EMAIL',
  permission: 'EXTERNAL_ACTION',
  timeoutMs: 20000,
  schema: z.object({ to: z.string().default(''), subject: z.string().min(2), body: z.string().min(4) }),
  async handler(args, ctx) {
    const integration = await integrationStatus(ctx, 'gmail');
    const draft = await prisma.emailDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        projectId: ctx.projectId ?? null,
        runId: ctx.runId ?? null,
        to: args.to,
        subject: args.subject,
        body: args.body,
        status: 'DRAFT',
        syncStatus: integration ? 'LOCAL' : 'NOT_CONNECTED',
      },
    });
    return {
      created: true,
      id: draft.id,
      subject: draft.subject,
      to: draft.to,
      status: draft.status,
      note: integration
        ? 'Draft saved. It will not be sent until you send it or enable auto-send.'
        : 'Draft saved locally. Connect Gmail in Settings → Integrations to send it.',
    };
  },
};

export const external: AnyTool[] = [githubRepository, githubIssueCreate, calendarCreate, emailDraft];
