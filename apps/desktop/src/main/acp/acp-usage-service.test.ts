import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  cacheAcpRateLimits,
  clearAcpRateLimitCache,
  getAcpRateLimits,
} from './acp-usage-service'
import type { ProviderRateLimits } from '@superone/shared/agent-types'
import type { Session } from '../session/types'

const SAMPLE: ProviderRateLimits = {
  title: 'Grok Build',
  planType: 'SuperGrok Heavy',
  windows: [{ label: 'Weekly limit', usedPercent: 0, resetsAt: null }],
  extraUsage: null,
  fetchedAt: 1,
}

describe('acp-usage-service', () => {
  afterEach(() => {
    clearAcpRateLimitCache()
  })

  it('returns a runtime-ready prefetch without asking the session again', async () => {
    cacheAcpRateLimits('grok-build', SAMPLE)
    const session = {
      getRateLimits: async () => {
        throw new Error('should not hit the live session')
      },
    } as unknown as Session

    await expect(getAcpRateLimits('grok-build', session)).resolves.toEqual(SAMPLE)
  })

  it('does not cache an empty answer so a later prefetch can fill the gauge', async () => {
    const session = {
      getRateLimits: async () => null,
    } as unknown as Session
    await expect(getAcpRateLimits('grok-build', session)).resolves.toBeNull()

    cacheAcpRateLimits('grok-build', SAMPLE)
    await expect(getAcpRateLimits('grok-build', session)).resolves.toEqual(SAMPLE)
  })
})
