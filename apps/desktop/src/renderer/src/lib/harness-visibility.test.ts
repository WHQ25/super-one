import { describe, expect, it } from 'vitest'
import {
  catalogEntryOn,
  catalogIdForSessionProvider,
  isCatalogHarnessDisabled,
  isCatalogHarnessEnabled,
  isClaudeHarnessEnabled,
  isCodexHarnessEnabled,
  isDeepseekHarnessEnabled,
  isGrokHarnessEnabled,
  isOpenCodeEnabled,
} from './harness-visibility'

const allOff = [
  { id: 'claude', enabled: false, state: 'disabled' },
  { id: 'codex', enabled: false, state: 'disabled' },
  { id: 'opencode', enabled: false, state: 'disabled' },
  { id: 'acp-grok', enabled: false, state: 'disabled' },
  { id: 'deepseek', enabled: false, state: 'disabled' },
]

const claudeOn = [
  { id: 'claude', enabled: true, state: 'ready' },
  { id: 'codex', enabled: false, state: 'disabled' },
  { id: 'opencode', enabled: false, state: 'disabled' },
  { id: 'acp-grok', enabled: true, state: 'ready' },
  { id: 'deepseek', enabled: true, state: 'ready' },
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
    expect(isDeepseekHarnessEnabled(null)).toBe(false)
  })

  it('hard-filters from catalog when loaded', () => {
    expect(isClaudeHarnessEnabled(allOff)).toBe(false)
    expect(isCodexHarnessEnabled(allOff)).toBe(false)
    expect(isClaudeHarnessEnabled(claudeOn)).toBe(true)
    expect(isCatalogHarnessEnabled(claudeOn, 'acp-grok')).toBe(true)
    expect(isOpenCodeEnabled(claudeOn)).toBe(false)
    expect(isDeepseekHarnessEnabled(claudeOn)).toBe(true)
    expect(isDeepseekHarnessEnabled(allOff)).toBe(false)
  })

  it('legacy experimental master still unlocks opencode', () => {
    expect(isOpenCodeEnabled(allOff, true)).toBe(true)
  })

  it('isCatalogHarnessDisabled only fires when catalog is known and row is off', () => {
    expect(isCatalogHarnessDisabled(null, 'claude')).toBe(false)
    expect(isCatalogHarnessDisabled(claudeOn, 'claude')).toBe(false)
    expect(isCatalogHarnessDisabled(claudeOn, 'codex')).toBe(true)
    expect(isCatalogHarnessDisabled(allOff, 'claude')).toBe(true)
    // Missing row is not "disabled" — unknown ids stay out of the read-only path.
    expect(isCatalogHarnessDisabled(claudeOn, 'cursor')).toBe(false)
  })

  it('catalogIdForSessionProvider maps product providers, skips experimental ACP', () => {
    expect(catalogIdForSessionProvider('claude')).toBe('claude')
    expect(catalogIdForSessionProvider('codex')).toBe('codex')
    expect(catalogIdForSessionProvider('acp', null)).toBe('acp-grok')
    expect(catalogIdForSessionProvider('acp', 'some-custom-agent')).toBe(null)
  })
})
