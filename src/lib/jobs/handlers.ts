/**
 * Job handler registrations.
 *
 * A handler is the single implementation of a unit of deferred work. Both the
 * inline driver (runs it now) and the queue driver (runs it later, with retries)
 * call exactly the same function.
 */

import { registerHandler } from './index';
import { runWorkflow } from '../orchestration/workflow-engine';

registerHandler('workflow.run', async (payload) =>
  runWorkflow({
    workflowId: String(payload.workflowId),
    userId: String(payload.userId),
    workspaceId: String(payload.workspaceId),
    projectId: (payload.projectId as string | null | undefined) ?? null,
    input: (payload.input as Record<string, unknown> | undefined) ?? {},
  }),
);
