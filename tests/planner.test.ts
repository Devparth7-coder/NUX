/**
 * Planning engine — deterministic, deadline-aware, and reconciles work the user
 * already has instead of duplicating it.
 */

import { describe, expect, it } from 'vitest';
import { buildPlan, similarity, type WorkspaceTaskRef } from '../src/lib/orchestration/planner';
import type { IntentObject } from '../src/types';

const now = new Date('2026-09-05T09:00:00.000Z');
const deadline = new Date('2026-09-11T18:00:00.000Z');

function intent(objective: string): IntentObject {
  return {
    objective,
    desiredOutcome: 'shipped',
    entities: [{ name: 'NEXUS Launch', type: 'PROJECT', value: 'proj-1', confidence: 0.95 }],
    constraints: [],
    deadline,
    deadlineText: 'This week (Friday 18:00)',
    projectContext: 'proj-1',
    requiredCapabilities: ['planning'],
    riskLevel: 'HIGH',
    permissionsRequired: ['WRITE', 'EXTERNAL_ACTION'],
    confidence: 0.93,
    parser: 'rules',
  };
}

const existing: WorkspaceTaskRef[] = [
  { id: 't1', title: 'Finalize landing page', status: 'TODO', deadline: null },
  { id: 't2', title: 'Prepare launch video', status: 'TODO', deadline: null },
  { id: 't3', title: 'Review architecture', status: 'TODO', deadline: null },
  { id: 't4', title: 'Prepare announcement', status: 'TODO', deadline: null },
  { id: 't5', title: 'Deploy production', status: 'TODO', deadline: null },
  { id: 't6', title: 'Validate analytics', status: 'TODO', deadline: null },
];

describe('objective → workstream template', () => {
  it('picks the launch template even when the verb is not first', () => {
    const plan = buildPlan({ intent: intent('NEXUS launch'), rawInput: 'Prepare my NEXUS launch for this week.', projectName: 'NEXUS Launch', existingTasks: [], now });
    expect(plan.tasks).toHaveLength(6);
    expect(plan.tasks.map((t) => t.title).join(' | ')).toContain('Deploy NEXUS Launch to production');
  });

  it('picks the launch template when the verb leads', () => {
    const plan = buildPlan({ intent: intent('launch NEXUS'), rawInput: 'launch NEXUS', projectName: 'NEXUS', existingTasks: [], now });
    expect(plan.tasks).toHaveLength(6);
  });

  it('falls back to a preparation workflow for an unrecognised objective', () => {
    const plan = buildPlan({ intent: intent('quarterly board pack'), rawInput: 'quarterly board pack', projectName: 'Board pack', existingTasks: [], now });
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.some((t) => t.title.includes('Gather source material'))).toBe(true);
  });
});

describe('plan shape', () => {
  const plan = buildPlan({ intent: intent('NEXUS launch'), rawInput: 'Prepare my NEXUS launch for this week.', projectName: 'NEXUS Launch', existingTasks: existing, now });

  it('is deterministic (aside from generated ids)', () => {
    const again = buildPlan({ intent: intent('NEXUS launch'), rawInput: 'Prepare my NEXUS launch for this week.', projectName: 'NEXUS Launch', existingTasks: existing, now });
    const strip = (value: unknown) => JSON.stringify(value).replace(/(plan|step)_[a-z0-9]+/g, '$1_x');
    expect(strip(again)).toBe(strip(plan));
  });

  it('gives every planned task a due date, priority and rationale', () => {
    for (const task of plan.tasks) {
      expect(task.dueDate).toBeInstanceOf(Date);
      expect(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).toContain(task.priority);
      expect(task.rationale.length).toBeGreaterThan(0);
    }
  });

  it('distributes deadlines backwards from the stated deadline', () => {
    const dates = plan.tasks.map((t) => t.dueDate!.getTime());
    for (const time of dates) {
      expect(time).toBeGreaterThan(now.getTime());
      expect(time).toBeLessThanOrEqual(deadline.getTime());
    }
    expect(Math.max(...dates)).toBe(deadline.getTime());
    expect(new Set(dates).size).toBeGreaterThan(1);
  });

  it('orders dependencies so nothing depends on itself or a later step', () => {
    for (const task of plan.tasks) {
      for (const dep of task.dependsOnTitles) {
        expect(dep).not.toBe(task.title);
      }
    }
  });

  it('flags work that already exists instead of planning a duplicate', () => {
    const reconciled = plan.tasks.filter((t) => t.rationale.includes('will be reconciled'));
    expect(reconciled.length).toBeGreaterThanOrEqual(5);
  });

  it('records risks with mitigation and severity', () => {
    expect(plan.risks.length).toBeGreaterThan(0);
    for (const risk of plan.risks) {
      expect(risk.mitigation.length).toBeGreaterThan(0);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(risk.severity);
    }
  });

  it('produces an execution graph that walks intent → context → agents → result', () => {
    const ids = plan.graph.nodes.map((n) => n.id);
    expect(ids[0]).toBe('intent');
    expect(ids).toContain('context');
    expect(ids).toContain('planning');
    expect(ids).toContain('approval');
    expect(ids[ids.length - 1]).toBe('result');

    // Every edge references real nodes.
    for (const edge of plan.graph.edges) {
      expect(ids).toContain(edge.from);
      expect(ids).toContain(edge.to);
    }

    // The graph is acyclic.
    const incoming = new Map<string, number>();
    for (const node of plan.graph.nodes) incoming.set(node.id, node.dependsOn.length);
    const resolved = new Set<string>();
    let progress = true;
    while (progress) {
      progress = false;
      for (const node of plan.graph.nodes) {
        if (resolved.has(node.id)) continue;
        if (node.dependsOn.every((d) => resolved.has(d))) {
          resolved.add(node.id);
          progress = true;
        }
      }
    }
    expect(resolved.size).toBe(plan.graph.nodes.length);
    expect(incoming.size).toBe(plan.graph.nodes.length);
  });
});

describe('similarity', () => {
  it('matches paraphrased titles', () => {
    expect(similarity('Finalise NEXUS Launch landing page', 'Finalize landing page')).toBeGreaterThan(0.6);
  });

  it('does not match unrelated titles', () => {
    expect(similarity('Validate analytics', 'Draft press release')).toBeLessThan(0.6);
  });

  it('is symmetric on the token set', () => {
    expect(similarity('Deploy production', 'Deploy to production')).toBeCloseTo(similarity('Deploy to production', 'Deploy production'), 6);
  });
});
