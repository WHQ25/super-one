import { describe, it, expect } from 'vitest'
import { resolveAcpLaunch, getBuiltinAgent } from './agent-catalog'

describe('agent-catalog', () => {
  it('resolves grok-build builtin', () => {
    const launch = resolveAcpLaunch({ agentId: 'grok-build', defaultCwd: '/proj' })
    expect(launch.command).toBe('grok')
    expect(launch.args).toEqual(['agent', 'stdio'])
    expect(launch.cwd).toBe('/proj')
  })

  it('allows command override', () => {
    const launch = resolveAcpLaunch({
      agentId: 'grok-build',
      command: 'npx',
      args: ['-y', '@xai-official/grok', 'agent', 'stdio'],
      defaultCwd: '/proj',
    })
    expect(launch.command).toBe('npx')
    expect(launch.args[0]).toBe('-y')
  })

  it('throws when custom has no command', () => {
    expect(() => resolveAcpLaunch({ agentId: 'custom', defaultCwd: '/p' })).toThrow(/command/)
  })

  it('lists builtin agents', () => {
    expect(getBuiltinAgent('grok-build')?.name).toBe('Grok Build')
  })
})
