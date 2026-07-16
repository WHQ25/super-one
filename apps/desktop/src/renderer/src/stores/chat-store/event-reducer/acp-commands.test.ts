/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { SlashCommandInfo } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { applyEventToSession } = await import('./index')

const commands: SlashCommandInfo[] = [
  { name: 'web', description: 'Search', argumentHint: 'q', isSkill: false },
  { name: 'plan', description: 'Plan', argumentHint: '', isSkill: false },
]

describe('applyEventToSession: acp_commands', () => {
  it('stores agent commands when agent matches', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'opencode',
    }
    const patch = applyEventToSession(session, {
      type: 'acp_commands',
      agentId: 'opencode',
      commands,
    })
    expect(patch.acpSlashCommands).toEqual(commands)
    expect(patch.acpSlashCommandsStatus).toBe('ready')
  })

  it('drops commands from a different ACP agent', () => {
    const session = {
      ...createDefaultPerSessionState(),
      acpAgentId: 'opencode',
      acpSlashCommands: commands,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_commands',
      agentId: 'grok-build',
      commands: [{ name: 'x', description: '', argumentHint: '', isSkill: false }],
    })
    expect(patch).toEqual({})
  })

  it('replaces the full command list on update', () => {
    const session = {
      ...createDefaultPerSessionState(),
      acpAgentId: 'opencode',
      acpSlashCommands: commands,
    }
    const next: SlashCommandInfo[] = [
      { name: 'test', description: 'Run tests', argumentHint: '', isSkill: false },
    ]
    const patch = applyEventToSession(session, {
      type: 'acp_commands',
      agentId: 'opencode',
      commands: next,
    })
    expect(patch.acpSlashCommands).toEqual(next)
  })
})
