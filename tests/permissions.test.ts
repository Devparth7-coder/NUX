/**
 * Permission engine — the single gate every tool call passes through.
 */

import { describe, expect, it } from 'vitest';
import { authorize, DEFAULT_POLICY, type PermissionPolicy } from '../src/lib/permissions/engine';
import type { PermissionLevel } from '../src/types';

function ctx(overrides: Partial<Parameters<typeof authorize>[1]> = {}) {
  return {
    roleCeiling: 'HIGH_IMPACT' as PermissionLevel,
    policy: { ...DEFAULT_POLICY } as PermissionPolicy,
    connectedIntegrations: [] as string[],
    requiredIntegrations: [] as string[],
    grantedApprovals: [] as PermissionLevel[],
    ...overrides,
  };
}

describe('authorize', () => {
  it('allows reads by default', () => {
    expect(authorize('READ', ctx()).allowed).toBe(true);
  });

  it('allows writes by default', () => {
    expect(authorize('WRITE', ctx()).allowed).toBe(true);
  });

  it('requires approval for external actions', () => {
    const result = authorize('EXTERNAL_ACTION', ctx());
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('requires approval for high-impact actions', () => {
    const result = authorize('HIGH_IMPACT', ctx());
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('honours the role ceiling', () => {
    const result = authorize('HIGH_IMPACT', ctx({ roleCeiling: 'WRITE' }));
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(false);
    expect(result.reason).toMatch(/Your role permits up to WRITE/);
  });

  it('blocks a call whose integration is not connected and says where to fix it', () => {
    const result = authorize('EXTERNAL_ACTION', ctx({ requiredIntegrations: ['gmail'], connectedIntegrations: [] }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('gmail');
    expect(result.reason).toContain('Settings → Integrations');
  });

  it('checks integrations before the policy, so a connected service is still gated on permission', () => {
    const result = authorize('EXTERNAL_ACTION', ctx({ requiredIntegrations: ['gmail'], connectedIntegrations: ['gmail'] }));
    expect(result.requiresApproval).toBe(true);
  });

  it('strict mode makes even writes require approval', () => {
    const result = authorize('WRITE', ctx({ policy: { ...DEFAULT_POLICY, requireApprovalForAll: true } }));
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toMatch(/explicit approval for all mutating actions/);
  });

  it('treats a granted approval as covering only the granted level', () => {
    expect(authorize('WRITE', ctx({ grantedApprovals: ['WRITE'], policy: { ...DEFAULT_POLICY, requireApprovalForAll: true } })).allowed).toBe(true);
    const still = authorize('EXTERNAL_ACTION', ctx({ grantedApprovals: ['WRITE'] }));
    expect(still.allowed).toBe(false);
    expect(still.requiresApproval).toBe(true);
  });

  it('honours a policy that auto-approves external actions (explicit user setting)', () => {
    const result = authorize('EXTERNAL_ACTION', ctx({ policy: { ...DEFAULT_POLICY, EXTERNAL_ACTION: true } }));
    expect(result.allowed).toBe(true);
  });
});
