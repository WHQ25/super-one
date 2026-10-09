import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ readGrokRateLimits: vi.fn() }))
vi.mock('@superone/runtime/usage', () => runtime)
vi.mock('../agent/usage-log', () => ({ usageLog: { info: () => {}, warn: () => {} } }))

import { getAcpRateLimits } from './acp-usage-service'

const SAMPLE = { title: 'Grok Build', planType: 'SuperGrok Heavy', windows: [{ label: 'Weekly limit', usedPercent: 12, resetsAt: null }], extraUsage: null }

describe('acp-usage-service', () => {
  beforeEach(() => runtime.readGrokRateLimits.mockReset().mockResolvedValue({ value: SAMPLE }))

  it('reads Grok credits from the CLI login, passing a forced refresh through', async () => {
    await expect(getAcpRateLimits('grok-build', true)).resolves.toEqual(SAMPLE)
    expect(runtime.readGrokRateLimits).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
  })

  it('reports nothing for agents without account credits', async () => {
    await expect(getAcpRateLimits('gemini')).resolves.toBeNull()
    expect(runtime.readGrokRateLimits).not.toHaveBeenCalled()
  })
})
