import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _resetMainThreadSessionGuardForTests,
  denyMainThreadOnlyIfSubagent,
  liveAcpSubagentCount,
  noteAcpTaskLifecycle,
  noteParentMainThreadCall,
  PARENT_CALL_WAIT_MS,
} from './main-thread-session-guard'

/** Resolve a deny check that may wait for a parent call, without real time passing. */
async function settle(check: Promise<string | null>): Promise<string | null> {
  await vi.advanceTimersByTimeAsync(PARENT_CALL_WAIT_MS)
  return check
}

describe('main-thread session guard', () => {
  afterEach(() => {
    vi.useRealTimers()
    _resetMainThreadSessionGuardForTests()
  })

  it('allows session_tag when no ACP subagent is live', async () => {
    expect(await denyMainThreadOnlyIfSubagent('s1', 'session_tag')).toBeNull()
  })

  it('denies session_tag while a subagent is live and the parent announced no call', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1', taskType: 'general-purpose' })
    expect(liveAcpSubagentCount('s1')).toBe(1)
    expect(await settle(denyMainThreadOnlyIfSubagent('s1', 'session_tag'))).toMatch(/main thread/i)
    expect(await denyMainThreadOnlyIfSubagent('s1', 'session_list')).toBeNull()
  })

  it('allows a parent call announced on the parent stream while a subagent is live', async () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    noteParentMainThreadCall('s1', 'tc-1', 'mcp__superone__session_collab_send')
    expect(await denyMainThreadOnlyIfSubagent('s1', 'session_collab_send')).toBeNull()
  })

  it('spends each parent call once, so a subagent cannot ride on it', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    noteParentMainThreadCall('s1', 'tc-1', 'superone__session_collab_retrieve')
    // Updates of the same call do not mint another credit.
    noteParentMainThreadCall('s1', 'tc-1', 'superone__session_collab_retrieve')
    expect(await denyMainThreadOnlyIfSubagent('s1', 'session_collab_retrieve')).toBeNull()
    expect(await settle(denyMainThreadOnlyIfSubagent('s1', 'session_collab_retrieve'))).toMatch(/main thread/i)
  })

  it('does not let a credit for one tool authorize another', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    noteParentMainThreadCall('s1', 'tc-1', 'mcp__superone__session_tag')
    expect(await settle(denyMainThreadOnlyIfSubagent('s1', 'session_collab_send'))).toMatch(/main thread/i)
  })

  it('waits briefly for a parent call whose MCP request beat the stream', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    const check = denyMainThreadOnlyIfSubagent('s1', 'session_collab_send')
    await vi.advanceTimersByTimeAsync(PARENT_CALL_WAIT_MS / 2)
    noteParentMainThreadCall('s1', 'tc-1', 'mcp__superone__session_collab_send')
    expect(await check).toBeNull()
  })

  it('spends a parent credit even with no subagent live, so a later subagent cannot use it', async () => {
    vi.useFakeTimers()
    noteParentMainThreadCall('s1', 'tc-1', 'mcp__superone__session_tag')
    expect(await denyMainThreadOnlyIfSubagent('s1', 'session_tag')).toBeNull()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    expect(await settle(denyMainThreadOnlyIfSubagent('s1', 'session_tag'))).toMatch(/main thread/i)
  })

  it('expires an unspent parent credit', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    noteParentMainThreadCall('s1', 'tc-1', 'mcp__superone__session_tag')
    vi.setSystemTime(Date.now() + 120_000)
    expect(await settle(denyMainThreadOnlyIfSubagent('s1', 'session_tag'))).toMatch(/main thread/i)
  })

  it('ignores non-main-thread tools when crediting', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    noteParentMainThreadCall('s1', 'tc-1', 'mcp__superone__session_list')
    expect(await settle(denyMainThreadOnlyIfSubagent('s1', 'session_tag'))).toMatch(/main thread/i)
  })

  it('clears live subagents on terminal task_notification', async () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1', taskType: 'explore' })
    noteAcpTaskLifecycle('s1', { type: 'task_notification', taskId: 'sa-1', taskStatus: 'completed' })
    expect(liveAcpSubagentCount('s1')).toBe(0)
    expect(await denyMainThreadOnlyIfSubagent('s1', 'session_tag')).toBeNull()
  })

  it('ignores goal/workflow/monitor tasks', () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'g1', taskType: 'goal' })
    expect(liveAcpSubagentCount('s1')).toBe(0)
  })
})
