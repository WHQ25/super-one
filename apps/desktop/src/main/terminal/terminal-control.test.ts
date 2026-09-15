import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { TerminalControl, type ControlledTerminal } from './terminal-control'

function makeTerminal() {
  const events: TerminalEvent[] = []
  const state = { atShell: true, lastOutputAt: 0 }
  const terminal: ControlledTerminal = {
    terminalId: 't1',
    isAtShell: () => state.atShell,
    lastOutputAt: () => state.lastOutputAt,
    emit: (e) => events.push(e),
  }
  return { terminal, events, state }
}

const reasons = (events: TerminalEvent[]) =>
  events.filter((e) => e.type === 'terminal_control_changed').map((e) => (e as { reason: string }).reason)

describe('TerminalControl', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('grants, sees the command start, and releases when the shell is back', () => {
    const { terminal, events, state } = makeTerminal()
    const control = new TerminalControl(terminal, { pollMs: 100 })
    control.grant({ sessionId: 's1', command: 'bun run dev', startedAt: Date.now() })
    expect(control.heldBy('s1')).toBe(true)
    expect(control.commandRunning).toBe(false)

    state.atShell = false
    vi.advanceTimersByTime(100)
    expect(control.commandRunning).toBe(true)

    state.atShell = true
    vi.advanceTimersByTime(100)
    expect(control.current).toBeNull()
    expect(control.heldBy('s1')).toBe(false)
    expect(reasons(events)).toEqual(['granted', 'command_exited'])
  })

  it('releases an unobserved command after the grace window once output is quiet', () => {
    const { terminal, events, state } = makeTerminal()
    const control = new TerminalControl(terminal, { pollMs: 100, startGraceMs: 1000, idleMs: 400 })
    state.lastOutputAt = Date.now()
    control.grant({ sessionId: 's1', command: 'true', startedAt: Date.now() })

    vi.advanceTimersByTime(900)
    expect(control.current).not.toBeNull()

    // Output keeps arriving: still not released even past the grace window.
    state.lastOutputAt = Date.now()
    vi.advanceTimersByTime(200)
    expect(control.current).not.toBeNull()

    vi.advanceTimersByTime(500)
    expect(control.current).toBeNull()
    expect(reasons(events)).toEqual(['granted', 'command_exited'])
  })

  it('user take-over releases with its own reason and rejects the holder afterwards', () => {
    const { terminal, events, state } = makeTerminal()
    const control = new TerminalControl(terminal, { pollMs: 100 })
    control.grant({ sessionId: 's1', command: 'python3', startedAt: Date.now() })
    state.atShell = false
    vi.advanceTimersByTime(100)

    control.release('user_took_over')
    expect(control.heldBy('s1')).toBe(false)
    expect(reasons(events)).toEqual(['granted', 'user_took_over'])
    // No further polling after release.
    state.atShell = true
    vi.advanceTimersByTime(500)
    expect(reasons(events)).toHaveLength(2)
  })

  it('dispose releases an active grant as terminal_exited', () => {
    const { terminal, events } = makeTerminal()
    const control = new TerminalControl(terminal, { pollMs: 100 })
    control.grant({ sessionId: 's1', command: 'vim', startedAt: Date.now() })
    control.dispose()
    expect(reasons(events)).toEqual(['granted', 'terminal_exited'])
    control.dispose()
    expect(reasons(events)).toHaveLength(2)
  })
})
