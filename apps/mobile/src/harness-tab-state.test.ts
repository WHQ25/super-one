import { describe, expect, it } from 'vitest'
import type { HarnessId, RemoteHarnessOption } from '@superone/shared/agent-types'
import { harnessTabSlots } from './harness-tab-state'

const option = (key: string, label: string, provider: HarnessId = 'claude'): RemoteHarnessOption => ({
  key, label, provider, acpAgentId: provider === 'acp' ? key.replace('acp:', '') : null,
})

const claude = option('claude', 'Claude Code')
const codex = option('codex', 'Codex', 'codex')
const grok = option('acp:grok-build', 'Grok Build', 'acp')

describe('harnessTabSlots', () => {
  it('returns null when there is nothing to switch between', () => {
    expect(harnessTabSlots({ options: [], activeKey: 'claude' })).toBeNull()
    expect(harnessTabSlots({ options: [claude], activeKey: 'claude' })).toBeNull()
  })

  it('keeps the second slot a plain tab when exactly two options exist', () => {
    expect(harnessTabSlots({ options: [claude, codex], activeKey: 'claude' }))
      .toEqual({ fixed: claude, menu: [codex], menuTab: codex, menuActive: false })
  })

  it('names the active option in the second slot when it lives there', () => {
    const slots = harnessTabSlots({ options: [claude, codex, grok], activeKey: 'acp:grok-build' })
    expect(slots?.menuTab).toEqual(grok)
    expect(slots?.menuActive).toBe(true)
  })

  it('falls back to the remembered pick while the fixed slot is active', () => {
    const slots = harnessTabSlots({
      options: [claude, codex, grok], activeKey: 'claude', rememberedKey: 'acp:grok-build',
    })
    expect(slots?.menuTab).toEqual(grok)
    expect(slots?.menuActive).toBe(false)
  })

  it('ignores a remembered pick the host no longer offers', () => {
    const slots = harnessTabSlots({
      options: [claude, codex], activeKey: 'claude', rememberedKey: 'acp:grok-build',
    })
    expect(slots?.menuTab).toEqual(codex)
  })

  it('de-duplicates by suggestion key before splitting', () => {
    // Two ACP agents share the `acp` provider, so identity is the key, not the id.
    const slots = harnessTabSlots({ options: [claude, claude, codex], activeKey: 'codex' })
    expect(slots).toEqual({ fixed: claude, menu: [codex], menuTab: codex, menuActive: true })
  })

  it('keeps one row per ACP agent rather than collapsing them onto `acp`', () => {
    const kimi = option('acp:kimi', 'Kimi', 'acp')
    const slots = harnessTabSlots({ options: [claude, grok, kimi], activeKey: 'claude' })
    expect(slots?.menu.map((row) => row.label)).toEqual(['Grok Build', 'Kimi'])
  })
})
