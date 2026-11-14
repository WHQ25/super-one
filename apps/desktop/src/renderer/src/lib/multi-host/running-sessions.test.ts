import { describe, expect, it } from 'vitest'
import { countRunningByHarness, parseRunningHarnessSignature, runningHarnessSignature, runningHarnessSignatureForConnection } from './running-sessions'

describe('countRunningByHarness', () => {
  it('groups streaming and background work by harness and drops everything else', () => {
    const rows = countRunningByHarness([
      { status: 'streaming', sessionProvider: 'codex' },
      { status: 'background', sessionProvider: 'claude' },
      { status: 'streaming', sessionProvider: 'claude' },
      { status: 'idle', sessionProvider: 'claude' },
      { status: 'streaming', sessionProvider: 'acp', acpAgentId: 'grok-build' },
      { status: 'streaming', _sideChatParentId: 'parent', sessionProvider: 'codex' },
      { status: 'streaming' },
    ])

    const expected = [
      { provider: 'claude', acpAgentId: null, count: 2 },
      { provider: 'codex', acpAgentId: null, count: 1 },
      { provider: 'acp', acpAgentId: 'grok-build', count: 1 },
    ]
    expect(rows).toEqual(expected)
    expect(parseRunningHarnessSignature(runningHarnessSignature([
      { status: 'streaming', sessionProvider: 'codex' },
      { status: 'background', sessionProvider: 'claude' },
      { status: 'streaming', sessionProvider: 'claude' },
      { status: 'streaming', sessionProvider: 'acp', acpAgentId: 'grok-build' },
    ]))).toEqual(expected)
  })
})

describe('runningHarnessSignatureForConnection', () => {
  const projects = {
    '/src/app': { _sessions: {
      a: { status: 'streaming', sessionProvider: 'claude' },
      b: { status: 'background', sessionProvider: 'codex' },
    } },
    'remote:cli-1:/srv/app': { _sessions: {
      c: { status: 'background', sessionProvider: 'codex' },
      d: { status: 'idle', sessionProvider: 'codex' },
    } },
    'remote:cli-2:/srv/other': { _sessions: { e: { status: 'streaming', sessionProvider: 'claude' } } },
  }

  it('groups this computer separately from one node', () => {
    expect(parseRunningHarnessSignature(runningHarnessSignatureForConnection(projects, 'local', true))).toEqual([
      { provider: 'claude', acpAgentId: null, count: 1 },
      { provider: 'codex', acpAgentId: null, count: 1 },
    ])
    expect(parseRunningHarnessSignature(runningHarnessSignatureForConnection(projects, 'cli-1', false))).toEqual([
      { provider: 'codex', acpAgentId: null, count: 1 },
    ])
    expect(parseRunningHarnessSignature(runningHarnessSignatureForConnection(projects, 'cli-2', false))).toEqual([
      { provider: 'claude', acpAgentId: null, count: 1 },
    ])
  })
})
