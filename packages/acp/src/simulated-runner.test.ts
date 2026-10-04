import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./run-turn', () => ({
  createAcpAgentTurnRunner: vi.fn(() => async () => ({ text: '' })),
}))

import { createAcpAgentTurnRunner } from './run-turn'
import { createAcpTurnRunner, resolveAcpProductionLaunch } from './simulated-runner'

afterEach(() => {
  delete process.env.SUPERONE_ACP_BINARY
  delete process.env.SUPERONE_ACP_COMMAND
  delete process.env.SUPERONE_ACP_ARGS
  vi.mocked(createAcpAgentTurnRunner).mockClear()
})

describe('resolveAcpProductionLaunch', () => {
  it('defaults grok args and agent id when none are supplied', () => {
    expect(resolveAcpProductionLaunch({ binaryPath: 'grok' })).toEqual({
      command: 'grok',
      args: ['agent', 'stdio'],
      agentId: 'grok-build',
    })
  })

  it('keeps explicit args and still labels the production launch grok-build', () => {
    expect(resolveAcpProductionLaunch({ binaryPath: 'grok', args: ['--flag'] })).toMatchObject({
      args: ['--flag'],
      agentId: 'grok-build',
    })
  })

  it('treats an empty arg list as the grok stdio default', () => {
    expect(resolveAcpProductionLaunch({ binaryPath: 'grok', args: [] })?.args).toEqual(['agent', 'stdio'])
  })

  it('returns null for a missing absolute binary', () => {
    expect(resolveAcpProductionLaunch({ binaryPath: '/missing/grok' })).toBeNull()
  })
})

describe('createAcpTurnRunner', () => {
  it('fail-closes in production when no binary is configured', async () => {
    const runner = createAcpTurnRunner({ allowSimulatedFallback: false })
    await expect(runner({} as never)).rejects.toThrow(/SUPERONE_ACP_BINARY/)
  })
})
