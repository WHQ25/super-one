/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reducePermission } = await import('./permission')

function permReq(id: string): PermissionRequest {
  return { requestId: id, sessionId: 's', toolName: 'Bash', input: {}, suggestions: [] } as never
}

describe('reducePermission: permission_request', () => {
  it('appends the new permission request to pendingPermissions', () => {
    const session = createDefaultPerSessionState()
    const req = permReq('p-1')
    const patch = reducePermission(session, { type: 'permission_request', request: req } as never)
    expect(patch.pendingPermissions).toEqual([req])
  })

  it('dedupes — if requestId already pending, returns empty patch', () => {
    const session = createDefaultPerSessionState()
    session.pendingPermissions = [permReq('p-1')]
    expect(reducePermission(session, { type: 'permission_request', request: permReq('p-1') } as never)).toEqual({})
  })
})

describe('reducePermission: permission_mode_change', () => {
  it('writes the new mode', () => {
    expect(
      reducePermission(createDefaultPerSessionState(), { type: 'permission_mode_change', mode: 'plan' } as never),
    ).toEqual({ permissionMode: 'plan' })
  })
})

describe('reducePermission: agent_setting_change', () => {
  it('writes selectedModel + modelUserChosen and clears effortUserChosen iff selectedEffort given', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change',
      patch: { selectedModel: 'opus-4-8', selectedEffort: 'high' },
    } as never)
    expect(patch.selectedModel).toBe('opus-4-8')
    expect(patch.modelUserChosen).toBe(true)
    expect(patch.selectedEffort).toBe('high')
    expect(patch.effortUserChosen).toBe(true)
  })

  it('reads top-level selectedModel + selectedEffort fields when patch is missing', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change',
      selectedModel: 'sonnet-4-6', selectedEffort: 'low',
    } as never)
    expect(patch.selectedModel).toBe('sonnet-4-6')
    expect(patch.selectedEffort).toBe('low')
  })

  it('writes codex model/effort + sets codex user-chosen flags', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change',
      patch: { selectedCodexModel: 'gpt-5-high', selectedCodexReasoningEffort: 'high' },
    } as never)
    expect(patch.selectedCodexModel).toBe('gpt-5-high')
    expect(patch.codexModelUserChosen).toBe(true)
    expect(patch.selectedCodexReasoningEffort).toBe('high')
    expect(patch.codexReasoningEffortUserChosen).toBe(true)
  })

  it('writes codex permission preset', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change', patch: { selectedCodexPermissionPreset: 'full-access' },
    } as never)
    expect(patch.selectedCodexPermissionPreset).toBe('full-access')
  })

  it('writes codex collaboration mode + clears plan-reject hint', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change', patch: { selectedCodexCollaborationMode: 'plan' },
    } as never)
    expect(patch.selectedCodexCollaborationMode).toBe('plan')
    expect(patch.codexPlanRejectHintActive).toBe(false)
  })

  it('writes permissionMode override', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change', patch: { permissionMode: 'bypassPermissions' },
    } as never)
    expect(patch.permissionMode).toBe('bypassPermissions')
  })

  it('writes OpenCode agent selection', () => {
    const patch = reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change', patch: { openCodeAgentId: 'general' },
    } as never)
    expect(patch.openCodeAgentId).toBe('general')
  })

  it("writes apiProviderId (null normalizes to null)", () => {
    expect(reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change', patch: { apiProviderId: 'gateway-1' },
    } as never).apiProviderId).toBe('gateway-1')
    expect(reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change', patch: { apiProviderId: null },
    } as never).apiProviderId).toBeNull()
  })

  it('emits an empty patch when no fields are specified', () => {
    expect(reducePermission(createDefaultPerSessionState(), {
      type: 'agent_setting_change',
    } as never)).toEqual({})
  })
})

describe('reducePermission: interaction_resolved', () => {
  it("interactionType='permission' filters out the resolved permission request", () => {
    const session = createDefaultPerSessionState()
    session.pendingPermissions = [permReq('p-1'), permReq('p-2')]
    const patch = reducePermission(session, {
      type: 'interaction_resolved', interactionType: 'permission', requestId: 'p-1',
    } as never)
    expect((patch.pendingPermissions ?? []).map((p) => p.requestId)).toEqual(['p-2'])
  })

  it("interactionType='question' clears the matching pendingQuestion only", () => {
    const session = createDefaultPerSessionState()
    session.pendingQuestion = { requestId: 'q-1' } as never
    expect(reducePermission(session, {
      type: 'interaction_resolved', interactionType: 'question', requestId: 'q-1',
    } as never)).toEqual({ pendingQuestion: null })
  })

  it("interactionType='question' with mismatched id is a no-op", () => {
    const session = createDefaultPerSessionState()
    session.pendingQuestion = { requestId: 'q-1' } as never
    expect(reducePermission(session, {
      type: 'interaction_resolved', interactionType: 'question', requestId: 'q-other',
    } as never)).toEqual({})
  })

  it("interactionType='plan_approval' records approval outcome and clears pendingPlanApproval", () => {
    const session = createDefaultPerSessionState()
    session.pendingPlanApproval = { requestId: 'pa-1' } as never
    const patch = reducePermission(session, {
      type: 'interaction_resolved', interactionType: 'plan_approval', requestId: 'pa-1',
      approved: true, feedback: 'lgtm',
    } as never)
    expect(patch.pendingPlanApproval).toBeNull()
    expect(patch.planApprovalOutcome).toEqual({ approved: true, feedback: 'lgtm' })
  })

  it("interactionType='plan_approval' with mismatched requestId is a no-op", () => {
    const session = createDefaultPerSessionState()
    session.pendingPlanApproval = { requestId: 'pa-1' } as never
    expect(reducePermission(session, {
      type: 'interaction_resolved', interactionType: 'plan_approval', requestId: 'other',
    } as never)).toEqual({})
  })
})
