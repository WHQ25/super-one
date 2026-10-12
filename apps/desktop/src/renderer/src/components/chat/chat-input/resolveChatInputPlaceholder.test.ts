import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { HarnessId } from '@superone/shared/agent-types'
import { inPlanMode, type PlanModeFields } from '@/harness-ui/strategies'
import { resolveChatInputPlaceholder } from './resolveChatInputPlaceholder'

const t = ((key: string, options?: { agent?: string }) => options?.agent ? `${key}:${options.agent}` : key) as TFunction

function placeholder(provider: HarnessId, fields: Partial<PlanModeFields>, acpAgentName = ''): string {
  const session = { permissionMode: 'default', selectedCodexCollaborationMode: 'default', openCodeAgentId: null, ...fields } as PlanModeFields
  return resolveChatInputPlaceholder(t, { provider, planMode: inPlanMode(provider, session), acpAgentName })
}

describe('resolveChatInputPlaceholder', () => {
  it('uses the native OpenCode agent for planning copy', () => {
    expect(placeholder('opencode', {})).toBe('chat.placeholder.openCodeAsk')
    expect(placeholder('opencode', { openCodeAgentId: 'plan' })).toBe('chat.placeholder.openCodePlan')
    // OpenCode has no permission modes; a stray `plan` mode is not its plan agent.
    expect(placeholder('opencode', { permissionMode: 'plan' })).toBe('chat.placeholder.openCodeAsk')
  })

  it('uses Cursor copy for normal and plan modes', () => {
    expect(placeholder('cursor', {})).toBe('chat.placeholder.cursorAsk')
    expect(placeholder('cursor', { permissionMode: 'plan' })).toBe('chat.placeholder.cursorPlan')
  })

  it('uses DeepSeek copy for normal and plan modes', () => {
    expect(placeholder('dsh', {})).toBe('chat.placeholder.deepseekAsk')
    expect(placeholder('dsh', { permissionMode: 'plan' })).toBe('chat.placeholder.deepseekPlan')
  })

  it('keeps provider-specific Claude, Codex and ACP copy', () => {
    expect(placeholder('claude', {})).toBe('chat.placeholder.claudeAsk')
    expect(placeholder('codex', { selectedCodexCollaborationMode: 'plan' })).toBe('chat.placeholder.codexPlan')
    expect(placeholder('codex', { permissionMode: 'plan' })).toBe('chat.placeholder.codexAsk')
    expect(placeholder('acp', {}, 'Gemini')).toBe('chat.placeholder.acpAsk:Gemini')
    expect(placeholder('acp', { permissionMode: 'plan' }, 'Grok')).toBe('chat.placeholder.acpPlan:Grok')
  })
})
