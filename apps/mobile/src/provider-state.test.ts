import { describe, expect, it } from 'vitest'
import { poweredByHint } from './provider-state'

const PROVIDER = { id: 'p1', name: 'Zhipu', presetKey: 'zhipu', modelEnv: {}, forcedEffort: null } as never

describe('poweredByHint', () => {
  it('shows nothing for harnesses that own their account', () => {
    expect(poweredByHint('acp')).toBeNull()
    expect(poweredByHint('opencode')).toBeNull()
    expect(poweredByHint('cursor')).toBeNull()
    expect(poweredByHint('dsh')).toBeNull()
  })

  it('falls back to the official provider per harness', () => {
    expect(poweredByHint('claude')).toEqual({ brandKey: 'claude', name: 'Claude Code (Official)' })
    expect(poweredByHint('codex')).toEqual({ brandKey: 'openai', name: 'Codex (Official)' })
  })

  it('names the active provider when the session has one', () => {
    expect(poweredByHint('claude', PROVIDER)).toEqual({ brandKey: 'zhipu', name: 'Zhipu' })
  })

  it('keeps the harness default brand when the provider has no preset', () => {
    expect(poweredByHint('codex', { ...(PROVIDER as object), presetKey: null } as never))
      .toEqual({ brandKey: 'openai', name: 'Zhipu' })
  })
})
