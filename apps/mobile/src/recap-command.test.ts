import { describe, expect, it } from 'vitest'
import { isManualRecapCommand, shouldInterceptGrokRecap } from './recap-command'

describe('isManualRecapCommand', () => {
  it('matches the bare command, including surrounding space', () => {
    expect(isManualRecapCommand('/recap')).toBe(true)
    expect(isManualRecapCommand('  /recap  ')).toBe(true)
  })

  it('rejects arguments, other commands, and a trailing prompt', () => {
    expect(isManualRecapCommand('/recap now')).toBe(false)
    expect(isManualRecapCommand('/mcp')).toBe(false)
    expect(isManualRecapCommand('please /recap')).toBe(false)
    expect(isManualRecapCommand('')).toBe(false)
  })
})

describe('shouldInterceptGrokRecap', () => {
  it('is host-only for Grok ACP', () => {
    expect(shouldInterceptGrokRecap('acp', 'grok-build')).toBe(true)
    expect(shouldInterceptGrokRecap('acp', 'grok')).toBe(true)
  })

  it('lets other agents send /recap as a prompt', () => {
    expect(shouldInterceptGrokRecap('acp', 'opencode')).toBe(false)
    expect(shouldInterceptGrokRecap('claude', 'grok-build')).toBe(false)
    expect(shouldInterceptGrokRecap('acp', null)).toBe(false)
  })
})
