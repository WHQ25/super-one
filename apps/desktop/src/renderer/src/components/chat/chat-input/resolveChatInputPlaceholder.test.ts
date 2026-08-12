import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { resolveChatInputPlaceholder } from './resolveChatInputPlaceholder'

const t = ((key: string, options?: { agent?: string }) => options?.agent ? `${key}:${options.agent}` : key) as TFunction

describe('resolveChatInputPlaceholder', () => {
  it('uses OpenCode copy for normal and plan modes', () => {
    expect(resolveChatInputPlaceholder(t, {
      provider: 'opencode',
      permissionMode: 'default',
      codexPlanMode: false,
      acpAgentName: '',
    })).toBe('chat.placeholder.openCodeAsk')
    expect(resolveChatInputPlaceholder(t, {
      provider: 'opencode',
      permissionMode: 'plan',
      codexPlanMode: false,
      acpAgentName: '',
    })).toBe('chat.placeholder.openCodePlan')
  })

  it('uses Cursor copy for normal and plan modes', () => {
    expect(resolveChatInputPlaceholder(t, {
      provider: 'cursor',
      permissionMode: 'default',
      codexPlanMode: false,
      acpAgentName: '',
    })).toBe('chat.placeholder.cursorAsk')
    expect(resolveChatInputPlaceholder(t, {
      provider: 'cursor',
      permissionMode: 'plan',
      codexPlanMode: false,
      acpAgentName: '',
    })).toBe('chat.placeholder.cursorPlan')
  })

  it('keeps provider-specific Claude, Codex and ACP copy', () => {
    expect(resolveChatInputPlaceholder(t, {
      provider: 'claude',
      permissionMode: 'default',
      codexPlanMode: false,
      acpAgentName: '',
    })).toBe('chat.placeholder.claudeAsk')
    expect(resolveChatInputPlaceholder(t, {
      provider: 'codex',
      permissionMode: 'default',
      codexPlanMode: true,
      acpAgentName: '',
    })).toBe('chat.placeholder.codexPlan')
    expect(resolveChatInputPlaceholder(t, {
      provider: 'acp',
      permissionMode: 'default',
      codexPlanMode: false,
      acpAgentName: 'Gemini',
    })).toBe('chat.placeholder.acpAsk:Gemini')
    expect(resolveChatInputPlaceholder(t, {
      provider: 'acp',
      permissionMode: 'plan',
      codexPlanMode: false,
      acpAgentName: 'Grok',
    })).toBe('chat.placeholder.acpPlan:Grok')
  })
})
