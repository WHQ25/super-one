import { describe, it, expect } from 'vitest'
import { HARNESS_CAPABILITIES } from './harness-capabilities'

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
  })
})
