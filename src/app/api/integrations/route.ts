import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { toolRegistry } from '@/lib/tools/registry';

export const runtime = 'nodejs';

const CATALOG = [
  { key: 'github', name: 'GitHub', description: 'Read repositories and open issues.', scopes: ['repo', 'issues:write'], tools: ['github.repository', 'github.issue.create'] },
  { key: 'google_drive', name: 'Google Drive', description: 'Index documents from Drive.', scopes: ['drive.readonly'], tools: ['documents.list'] },
  { key: 'google_calendar', name: 'Google Calendar', description: 'Sync events created by NEXUS.', scopes: ['calendar.events'], tools: ['calendar.create'] },
  { key: 'gmail', name: 'Gmail', description: 'Send approved drafts.', scopes: ['gmail.send'], tools: ['email.draft'] },
  { key: 'slack', name: 'Slack', description: 'Post updates to channels.', scopes: ['chat:write'], tools: [] },
  { key: 'notion', name: 'Notion', description: 'Sync pages into knowledge.', scopes: ['pages:read'], tools: [] },
];

export const GET = handler(async () => {
  const user = await requireUser();
  const rows = await prisma.integration.findMany({ where: { userId: user.id } });

  const items = CATALOG.map((entry) => {
    const row = rows.find((r) => r.key === entry.key);
    return {
      ...entry,
      status: row?.status ?? 'DISCONNECTED',
      accountLabel: row?.accountLabel ?? null,
      lastSyncedAt: row?.lastSyncedAt ?? null,
      errorMessage: row?.errorMessage ?? null,
      toolsAvailable: entry.tools.filter((t) => Boolean(toolRegistry.get(t))),
      // Credentials are never returned to the client.
      hasCredentials: Boolean(row?.credentials),
    };
  });

  return ok({ items });
});
