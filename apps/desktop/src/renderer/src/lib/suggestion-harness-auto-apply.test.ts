import { describe, expect, it } from 'vitest'
import { resolveAutoApplyHarness, type SuggestionHarnessOption } from './suggestion-harness-order'

const option = (provider: SuggestionHarnessOption['provider'], acpAgentId: string | null = null): SuggestionHarnessOption => ({
  key: acpAgentId ? `${provider}:${acpAgentId}` : provider,
  provider,
  acpAgentId,
  label: provider,
  sessionCount: 0,
})

const GROK = option('acp', 'grok-build')
const CODEX = option('codex')
const ORDERED = [GROK, CODEX]

const base = {
  disableAutoApply: false,
  harnessUserChosen: false,
  fixedHarness: GROK,
  suggestionHarness: { provider: 'acp' as const, acpAgentId: 'grok-build' },
  orderedHarnesses: ORDERED,
  messageCount: 0,
  lastAppliedKey: null as string | null,
  activeKey: 'claude',
}

describe('auto-applying the default harness to an empty session', () => {
  it('adopts the preferred harness on a fresh session', () => {
    expect(resolveAutoApplyHarness(base)).toEqual({ remember: GROK, apply: GROK })
  })

  /**
   * The bug this guards: starting a realtime call unmounts and remounts the harness
   * surface, which resets its in-component memory. Without session-level state the
   * auto-apply ran a second time and replaced the harness the user had just picked.
   */
  it('never overrules a harness the user picked by hand, even on a remount', () => {
    expect(resolveAutoApplyHarness({
      ...base,
      harnessUserChosen: true,
      activeKey: 'codex',
      lastAppliedKey: null,
    })).toEqual({ remember: null, apply: null })
  })

  it('remembers a target it did not need to switch to', () => {
    // Already on the target: nothing to apply, but a later re-run must not re-apply.
    expect(resolveAutoApplyHarness({ ...base, activeKey: GROK.key }))
      .toEqual({ remember: GROK, apply: null })
  })

  it('does not re-force the same target once applied', () => {
    expect(resolveAutoApplyHarness({ ...base, lastAppliedKey: GROK.key, activeKey: CODEX.key }))
      .toEqual({ remember: null, apply: null })
  })

  it('follows the preference to a different harness than the fixed tab', () => {
    expect(resolveAutoApplyHarness({
      ...base,
      suggestionHarness: { provider: 'codex', acpAgentId: null },
    })).toEqual({ remember: CODEX, apply: CODEX })
  })

  it('falls back to the fixed harness when the preference is no longer available', () => {
    expect(resolveAutoApplyHarness({
      ...base,
      suggestionHarness: { provider: 'opencode', acpAgentId: null },
    })).toEqual({ remember: GROK, apply: GROK })
  })

  it('waits while settings are still loading', () => {
    expect(resolveAutoApplyHarness({ ...base, suggestionHarness: undefined }))
      .toEqual({ remember: null, apply: null })
  })

  it('leaves a session that already has messages alone', () => {
    expect(resolveAutoApplyHarness({ ...base, messageCount: 1 }))
      .toEqual({ remember: null, apply: null })
  })

  it('stays out of a draft surface that opted out', () => {
    expect(resolveAutoApplyHarness({ ...base, disableAutoApply: true }))
      .toEqual({ remember: null, apply: null })
  })
})
