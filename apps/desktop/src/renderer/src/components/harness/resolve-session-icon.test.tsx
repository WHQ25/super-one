/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import type { HarnessId } from '@superone/shared/agent-types'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from './resolve-session-icon'

const HARNESS_IDS = Object.keys(HARNESS_DEFAULT_BRAND_HUE) as HarnessId[]

describe('resolveSessionIconFromBrandKey', () => {
  /**
   * The brandKey path is fed by resolveHarnessBrandKey (collab profiles, agent
   * mention chips, the launch confirm dialog). It used to key DeepSeek off
   * 'deepseek', a string nothing ever produced — brandKey defaults to the
   * harness id, so `dsh` fell through to null and rendered a generic robot.
   */
  it.each(HARNESS_IDS)('resolves the brand key emitted for harness %s', (harnessId) => {
    const brandKey = resolveHarnessBrandKey(harnessId, harnessId === 'acp' ? 'grok-build' : null)
    expect(resolveSessionIconFromBrandKey(brandKey), `no icon for brandKey ${brandKey}`)
      .not.toBeNull()
  })

  it('agrees with the harnessId path for every harness', () => {
    for (const harnessId of HARNESS_IDS) {
      const acpAgentId = harnessId === 'acp' ? 'grok-build' : null
      expect(resolveSessionIconFromBrandKey(resolveHarnessBrandKey(harnessId, acpAgentId)))
        .toBe(resolveSessionIcon(harnessId, acpAgentId))
    }
  })

  it('still accepts the deepseek display alias', () => {
    expect(resolveSessionIconFromBrandKey('deepseek'))
      .toBe(resolveSessionIconFromBrandKey('dsh'))
  })

  it('returns null for an unknown brand so callers can pick their own fallback', () => {
    expect(resolveSessionIconFromBrandKey('not-a-harness')).toBeNull()
    expect(resolveSessionIconFromBrandKey(null)).toBeNull()
  })
})
