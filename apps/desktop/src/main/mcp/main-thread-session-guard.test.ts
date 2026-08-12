import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetMainThreadSessionGuardForTests,
  denyMainThreadOnlyIfSubagent,
  grantParentMainThreadCall,
  liveAcpSubagentCount,
  noteAcpTaskLifecycle,
} from './main-thread-session-guard'

describe('main-thread session guard', () => {
  afterEach(() => {
    _resetMainThreadSessionGuardForTests()
  })

  it('allows session_tag when no ACP subagent is live', () => {
    expect(denyMainThreadOnlyIfSubagent('s1', 'session_tag')).toBeNull()
  })

  it('denies session_tag while a subagent is live and no parent grant exists', () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1', taskType: 'general-purpose' })
    expect(liveAcpSubagentCount('s1')).toBe(1)
    expect(denyMainThreadOnlyIfSubagent('s1', 'session_tag')).toMatch(/main thread/i)
    expect(denyMainThreadOnlyIfSubagent('s1', 'session_list')).toBeNull()
  })

  it('allows session_tag during a parent grant window', () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1' })
    grantParentMainThreadCall('s1', 1_000)
    expect(denyMainThreadOnlyIfSubagent('s1', 'session_tag', 1_500)).toBeNull()
    expect(denyMainThreadOnlyIfSubagent('s1', 'session_tag', 30_000)).toMatch(/main thread/i)
  })

  it('clears live subagents on terminal task_notification', () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'sa-1', taskType: 'explore' })
    noteAcpTaskLifecycle('s1', { type: 'task_notification', taskId: 'sa-1', taskStatus: 'completed' })
    expect(liveAcpSubagentCount('s1')).toBe(0)
    expect(denyMainThreadOnlyIfSubagent('s1', 'session_tag')).toBeNull()
  })

  it('ignores goal/workflow/monitor tasks', () => {
    noteAcpTaskLifecycle('s1', { type: 'task_started', taskId: 'g1', taskType: 'goal' })
    expect(liveAcpSubagentCount('s1')).toBe(0)
  })
})
