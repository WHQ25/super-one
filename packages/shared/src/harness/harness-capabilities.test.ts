import { describe, it, expect } from 'vitest'
import { HARNESS_CAPABILITIES, resolveGoalCapability } from './harness-capabilities'

describe('HARNESS_CAPABILITIES', () => {
  it('marks ACP host as supporting MCP, plan approval, and todos', () => {
    const acp = HARNESS_CAPABILITIES.acp
    expect(acp.supportsMcp).toBe(true)
    expect(acp.supportsPlanMode).toBe(true)
    expect(acp.supportsTodos).toBe(true)
    // Not yet: host enter-plan does not require subagents/compact flags.
    expect(acp.supportsSubagents).toBe(false)
    expect(acp.supportsCompact).toBe(false)
  })

  it('keeps Claude full-stack capabilities', () => {
    const c = HARNESS_CAPABILITIES.claude
    expect(c.supportsMcp).toBe(true)
    expect(c.supportsPlanMode).toBe(true)
    expect(c.supportsTodos).toBe(true)
    expect(c.supportsSubagents).toBe(true)
    expect(c.supportsQueuedSteer).toBe(true)
  })

  it('advertises the Codex experiences wired through app-server', () => {
    const codex = HARNESS_CAPABILITIES.codex
    expect(codex.supportsMcp).toBe(true)
    expect(codex.supportsPlanMode).toBe(true)
    expect(codex.supportsTodos).toBe(false)
    expect(codex.supportsSubagents).toBe(false)
    expect(codex.supportsCompact).toBe(true)
    expect(codex.supportsQueuedSteer).toBe(true)
  })
})

describe('resolveGoalCapability', () => {
  it('returns the harness entry for non-ACP harnesses', () => {
    expect(resolveGoalCapability('claude')?.canPause).toBe(false)
    expect(resolveGoalCapability('codex')?.transport).toBe('rpc')
    expect(resolveGoalCapability('opencode')).toBeNull()
  })

  it('only grants ACP a goal when the agent is Grok', () => {
    expect(resolveGoalCapability('acp', 'grok-build')?.canPause).toBe(true)
    expect(resolveGoalCapability('acp', 'gemini')).toBeNull()
    expect(resolveGoalCapability('acp', null)).toBeNull()
  })

  it('has no goal surface without a harness', () => {
    expect(resolveGoalCapability(null)).toBeNull()
  })
})

describe('goal lifecycle args', () => {
  it('lets Claude pass only /goal clear through, since it has no pause', () => {
    expect(HARNESS_CAPABILITIES.claude.goal?.lifecycleArgs).toEqual(['clear'])
  })

  it('routes every Codex /goal line to the dialog, because transitions are RPCs', () => {
    expect(HARNESS_CAPABILITIES.codex.goal?.lifecycleArgs).toEqual([])
  })
})
