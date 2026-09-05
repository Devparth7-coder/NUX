/**
 * Intent parsing — deterministic, and never invents entities that do not exist.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { parseIntent } from '../src/lib/intelligence/intent-engine';

const workspaceId = 'ws-intent-test';
const userId = 'user-intent-test';

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, email: 'intent-test@nexus.ai', name: 'Intent Test', passwordHash: 'x', role: 'OWNER' },
    update: {},
  });
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, name: 'Intent Test', slug: 'intent-test' },
    update: {},
  });
  await prisma.project.upsert({
    where: { id: 'proj-intent-test' },
    create: { id: 'proj-intent-test', workspaceId, ownerId: userId, name: 'NEXUS Launch', slug: 'nexus-launch' },
    update: {},
  });
});

async function parse(rawInput: string) {
  return parseIntent({ rawInput, workspaceId, userId });
}

describe('objective extraction', () => {
  it('reads the deadline out of "this week"', async () => {
    const intent = await parse('Prepare my NEXUS launch for this week.');
    expect(intent.objective).toBe('NEXUS launch');
    expect(intent.deadline).toBeInstanceOf(Date);
    // Always a Friday, always in the future, and the label matches the date.
    expect(intent.deadline!.getDay()).toBe(5);
    expect(intent.deadline!.getTime()).toBeGreaterThan(Date.now());
    expect(intent.deadline!.getHours()).toBe(18);
    expect(intent.deadlineText).toMatch(/Friday 18:00/);
    const isThisWeek = intent.deadlineText!.startsWith('This week');
    const daysAway = Math.round((intent.deadline!.getTime() - Date.now()) / 86_400_000);
    expect(isThisWeek ? daysAway <= 7 : daysAway > 0).toBe(true);
  });

  it('does not repeat the verb when the subject already carries it', async () => {
    const intent = await parse('I want to launch NEXUS this week.');
    expect(intent.objective).toBe('launch NEXUS');
  });

  it('strips dangling prepositions and possessives', async () => {
    const intent = await parse('Research competitors in the market');
    expect(intent.objective).toBe('research competitors in the market');
    expect(intent.objective.endsWith('for')).toBe(false);
  });

  it('resolves a real project into an entity', async () => {
    const intent = await parse('Prepare my NEXUS launch for this week.');
    const project = intent.entities.find((e) => e.type === 'PROJECT');
    expect(project?.name).toBe('NEXUS Launch');
    expect(intent.projectContext).toBe('proj-intent-test');
  });

  it('never invents a project entity for an unknown name', async () => {
    const intent = await parse('Launch Atlantis by Friday');
    expect(intent.entities.filter((e) => e.type === 'PROJECT')).toHaveLength(0);
    expect(intent.projectContext).toBeNull();
  });

  it('raises risk and required permissions for a deadline-bound launch', async () => {
    const intent = await parse('Prepare my NEXUS launch for this week.');
    expect(intent.riskLevel).toBe('HIGH');
    expect(intent.permissionsRequired).toContain('EXTERNAL_ACTION');
    expect(intent.requiredCapabilities).toContain('planning');
  });

  it('scores confidence from resolved signals, capped at 0.99', async () => {
    const intent = await parse('Prepare my NEXUS launch for this week.');
    expect(intent.confidence).toBeGreaterThan(0.8);
    expect(intent.confidence).toBeLessThanOrEqual(0.99);
  });

  it('parses an explicit weekday deadline', async () => {
    const intent = await parse('Ship the release by Tuesday');
    expect(intent.deadline).toBeInstanceOf(Date);
    expect(intent.deadline!.getDay()).toBe(2);
  });

  it('returns no deadline when none is stated', async () => {
    const intent = await parse('Summarise the architecture document');
    expect(intent.deadline).toBeNull();
    expect(intent.deadlineText).toBeNull();
  });
});
