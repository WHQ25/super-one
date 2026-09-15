import { describe, expect, it } from 'vitest'
import { TerminalSession } from './terminal-session'
import { TerminalOwnership } from './terminal-ownership'
import type { PtyLike, PtySpawner } from './pty'
import { hasWaitCondition, waitForTerminal } from './terminal-wait'

function makeSession() {
  let dataCb: (d: string) => void = () => {}
  const state = { foreground: 'zsh' }
  const pty: PtyLike & { emitData: (d: string) => void } = {
    write: () => {},
    resize: () => {},
    onData: (cb) => { dataCb = cb },
    onExit: () => {},
    kill: () => {},
    foregroundProcess: () => state.foreground,
    emitData: (d) => dataCb(d),
  }
  const spawner: PtySpawner = { spawn: () => pty }
  const session = new TerminalSession({
    terminalId: 't1',
    cwd: '/proj',
    title: 'zsh',
    cols: 80,
    rows: 24,
    spawner,
    ownership: new TerminalOwnership(),
    shell: '/bin/zsh',
    onEvent: () => {},
    control: { pollMs: 10 },
  })
  return { session, pty, state }
}

describe('waitForTerminal', () => {
  it('requires at least one condition', () => {
    expect(hasWaitCondition({})).toBe(false)
    expect(hasWaitCondition({ idleMs: 1 })).toBe(true)
  })

  it('resolves when text shows up in scrollback', async () => {
    const { session, pty } = makeSession()
    setTimeout(() => pty.emitData('Local:   http://localhost:6006\r\n'), 30)
    const result = await waitForTerminal(session, { text: 'localhost:6006' }, { timeoutMs: 2000, pollMs: 10 })
    expect(result.met).toBe(true)
    expect(result.conditions.text).toBe(true)
    session.kill()
  })

  it('times out with the conditions that did hold', async () => {
    const { session, pty } = makeSession()
    pty.emitData('$ ')
    const result = await waitForTerminal(session, { text: 'never', idleMs: 0 }, { timeoutMs: 50, pollMs: 10 })
    expect(result.met).toBe(false)
    expect(result.conditions).toEqual({ text: false, idle: true })
    session.kill()
  })

  it('does not count a tab that has never printed as idle', async () => {
    const { session, pty } = makeSession()
    const pending = waitForTerminal(session, { idleMs: 10 }, { timeoutMs: 2000, pollMs: 10 })
    setTimeout(() => pty.emitData('$ '), 40)
    const result = await pending
    expect(result.met).toBe(true)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(40)
    session.kill()
  })

  it('treats exited as "the controlled command left the foreground"', async () => {
    const { session, state } = makeSession()
    session.control.grant({ sessionId: 's1', command: 'sleep 1', startedAt: Date.now() })
    state.foreground = 'sleep'
    session.control.poll()
    expect(session.control.commandRunning).toBe(true)
    setTimeout(() => { state.foreground = 'zsh' }, 30)
    const result = await waitForTerminal(session, { exited: true }, { timeoutMs: 2000, pollMs: 10 })
    expect(result.met).toBe(true)
    expect(session.agentControl).toBeNull()
    session.kill()
  })

  it('stops early when the turn is aborted', async () => {
    const { session } = makeSession()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const result = await waitForTerminal(session, { text: 'never' }, { timeoutMs: 5000, pollMs: 10, signal: controller.signal })
    expect(result.met).toBe(false)
    expect(result.elapsedMs).toBeLessThan(1000)
    session.kill()
  })
})
