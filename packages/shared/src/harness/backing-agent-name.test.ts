import { describe, expect, it } from 'vitest'
import { backingAgentName } from './backing-agent-name'

describe('backingAgentName', () => {
  it('uses the harness display name', () => {
    expect(backingAgentName({ provider: 'codex' })).toBe('Codex')
    expect(backingAgentName({ provider: 'claude' })).toBe('Claude')
    expect(backingAgentName({ provider: 'cursor' })).toBe('Cursor')
    expect(backingAgentName({ provider: 'dsh' })).toBe('DeepSeek')
    expect(backingAgentName({ provider: 'opencode' })).toBe('OpenCode')
  })

  it('names the ACP agent instead of Others', () => {
    expect(backingAgentName({ provider: 'acp', acpAgentId: 'grok-build' })).toBe('Grok')
    expect(backingAgentName({
      provider: 'acp',
      acpAgentId: 'grok-build',
      acpAgentCatalogName: 'Grok Build',
    })).toBe('Grok')
    expect(backingAgentName({ provider: 'acp', acpAgentId: 'antigravity' })).toBe('Antigravity')
    expect(backingAgentName({ provider: 'acp', acpAgentId: 'some-agent' })).toBe('Some Agent')
    expect(backingAgentName({ provider: 'acp' })).toBe('ACP')
  })
})
