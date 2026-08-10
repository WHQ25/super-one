import { describe, expect, it } from 'vitest'
import {
  catalogEntryOn,
  isCatalogHarnessEnabled,
  isClaudeHarnessEnabled,
  isCodexHarnessEnabled,
  isGrokHarnessEnabled,
  isOpenCodeEnabled,
} from './harness-visibility'

const allOff = [
  { id: 'claude', enabled: false, state: 'disabled' },
  { id: 'codex', enabled: false, state: 'disabled' },
  { id: 'opencode', enabled: false, state: 'disabled' },
  { id: 'acp-grok', enabled: false, state: 'disabled' },
]

const claudeOn = [
  { id: 'claude', enabled: true, state: 'ready' },
  { id: 'codex', enabled: false, state: 'disabled' },
  { id: 'opencode', enabled: false, state: 'disabled' },
  { id: 'acp-grok', enabled: true, state: 'ready' },
]

describe('harness-visibility', () => {
  it('catalogEntryOn requires enabled and non-disabled state', () => {
    expect(catalogEntryOn(claudeOn, 'claude')).toBe(true)
    expect(catalogEntryOn(claudeOn, 'codex')).toBe(false)
    expect(catalogEntryOn([{ id: 'claude', enabled: true, state: 'installing' }], 'claude')).toBe(
      true,
    )
  })

  it('treats null catalog as nothing enabled (no fake Claude default)', () => {
    expect(isClaudeHarnessEnabled(null)).toBe(false)
    expect(isCodexHarnessEnabled(null)).toBe(false)
    expect(isOpenCodeEnabled(null)).toBe(false)
    expect(isGrokHarnessEnabled(null)).toBe(false)
  })

  it('hard-filters from catalog when loaded', () => {
    expect(isClaudeHarnessEnabled(allOff)).toBe(false)
    expect(isCodexHarnessEnabled(allOff)).toBe(false)
    expect(isClaudeHarnessEnabled(claudeOn)).toBe(true)
    expect(isCatalogHarnessEnabled(claudeOn, 'acp-grok')).toBe(true)
    expect(isOpenCodeEnabled(claudeOn)).toBe(false)
  })

  it('legacy experimental master still unlocks opencode', () => {
    expect(isOpenCodeEnabled(allOff, true)).toBe(true)
  })
})
