import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forwardSessionWorktreeTrace,
  logWorktreeWrite,
  readWorktreeSessionReader,
  registerWorktreeSessionReader,
  resetSessionWorktreeWriteLog,
  resetWorktreeSessionReader,
  SESSION_WORKTREE_TRACE_SOURCE,
  setSessionWorktreeLogEmitter,
} from './session-worktree-log'

const stale = '/Users/me/.worktrees/super-one/tmwp55-553f7bf'
const write = {
  projectPath: '/repo',
  sessionId: '7572410b-cfc5-4d35-9ab3-0e7e23da1322',
  before: null as string | null,
  after: stale,
  unsent: true,
}

afterEach(() => {
  resetSessionWorktreeWriteLog()
  resetWorktreeSessionReader()
  setSessionWorktreeLogEmitter(null)
  delete (globalThis as { window?: unknown }).window
})

describe('logWorktreeWrite', () => {
  it('formats a debug line and skips a null that did not change', () => {
    const lines: string[] = []
    setSessionWorktreeLogEmitter((line) => lines.push(line))
    logWorktreeWrite('triggerPrewarm', { ...write, before: null, after: null })
    logWorktreeWrite('triggerPrewarm', write)
    logWorktreeWrite('triggerPrewarm', write)
    expect(lines).toEqual([
      `[session-worktree] site=triggerPrewarm sid=7572410b project=/repo before=null after=${stale} unsent=true`,
    ])
  })

  it('logs one unchanged non-null write, then logs again when the path changes', () => {
    const lines: string[] = []
    setSessionWorktreeLogEmitter((line) => lines.push(line))
    logWorktreeWrite('worktreeHintForSession', { ...write, before: stale, after: stale })
    logWorktreeWrite('worktreeHintForSession', { ...write, before: stale, after: stale })
    logWorktreeWrite('worktreeHintForSession', { ...write, before: stale, after: '/repo' })
    expect(lines.map((line) => line.includes('after=/repo'))).toEqual([false, true])
    expect(lines).toHaveLength(2)
  })

  it('sends the renderer copy on the session.worktree trace source', () => {
    const trace = vi.fn()
    const lines: string[] = []
    ;(globalThis as { window?: { app: { trace: typeof trace } } }).window = { app: { trace } }
    setSessionWorktreeLogEmitter((line) => lines.push(line))
    logWorktreeWrite('triggerPrewarm', write)
    expect(trace).toHaveBeenCalledWith(
      SESSION_WORKTREE_TRACE_SOURCE,
      'triggerPrewarm',
      expect.stringContaining('sid=7572410b'),
    )
    expect(lines).toEqual([])
  })
})

describe('worktree session reader', () => {
  it('reads a reader registered after the chat store exists', () => {
    expect(readWorktreeSessionReader()).toBeNull()
    registerWorktreeSessionReader(() => ({ projectSessions: { '/repo': { _activeSessionId: '7572410b' } } }))
    expect(readWorktreeSessionReader()).toEqual({
      projectSessions: { '/repo': { _activeSessionId: '7572410b' } },
    })
  })
})

describe('forwardSessionWorktreeTrace', () => {
  const line = `[session-worktree] site=main.prewarm sid=7572410b project=/repo before=${stale} after=${stale} unsent=true`

  it('returns the line only for the dedicated source', () => {
    expect(forwardSessionWorktreeTrace(SESSION_WORKTREE_TRACE_SOURCE, line)).toBe(line)
    expect(forwardSessionWorktreeTrace('agent.store', line)).toBeNull()
    expect(forwardSessionWorktreeTrace('session.lifecycle', { worktreePath: stale })).toBeNull()
    expect(forwardSessionWorktreeTrace(SESSION_WORKTREE_TRACE_SOURCE, 'prewarm sid=7572410b')).toBeNull()
  })
})
