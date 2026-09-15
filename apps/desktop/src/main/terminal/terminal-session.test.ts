import { describe, it, expect, vi } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { TerminalSession } from './terminal-session'
import { TerminalOwnership } from './terminal-ownership'
import type { PtyLike, PtySpawner } from './pty'

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (e: { exitCode: number; signal: number | null }) => void = () => {}
  const pty: PtyLike & {
    emitData: (d: string) => void
    emitExit: (c: number) => void
    writes: string[]
    resizes: Array<[number, number]>
    killed: boolean
    foreground: string
  } = {
    writes: [],
    resizes: [],
    killed: false,
    foreground: 'zsh',
    foregroundProcess: () => pty.foreground,
    write: (d) => pty.writes.push(d),
    resize: (c, r) => pty.resizes.push([c, r]),
    onData: (cb) => {
      dataCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    kill: () => {
      pty.killed = true
    },
    emitData: (d) => dataCb(d),
    emitExit: (c) => exitCb({ exitCode: c, signal: null }),
  }
  return pty
}

function makeSession(opts?: { coalesceMs?: number; snapshotSoftLimit?: number }) {
  const pty = fakePty()
  const spawner: PtySpawner = { spawn: () => pty }
  const events: TerminalEvent[] = []
  const session = new TerminalSession({
    terminalId: 't1',
    cwd: '/proj',
    title: 'bash',
    cols: 80,
    rows: 24,
    spawner,
    ownership: new TerminalOwnership(),
    coalesceMs: opts?.coalesceMs ?? 8,
    snapshotSoftLimit: opts?.snapshotSoftLimit,
    shell: '/bin/zsh',
    onEvent: (e) => events.push(e),
  })
  return { session, pty, events }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('TerminalSession output coalescing', () => {
  it('coalesces chunks within a window into one terminal_output with a seq range', async () => {
    const { session, pty, events } = makeSession({ coalesceMs: 10 })
    pty.emitData('a')
    pty.emitData('b')
    pty.emitData('c')
    await tick(20)
    const out = events.filter((e) => e.type === 'terminal_output')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'terminal_output', data: 'abc', fromSeq: 1, toSeq: 3 })
    session.kill()
  })
})

describe('TerminalSession resize', () => {
  it('applies resize to the pty and de-duplicates identical dimensions', async () => {
    const { session, pty } = makeSession()
    session.resize(100, 30)
    session.resize(100, 30)
    session.resize(120, 40)
    expect(pty.resizes).toEqual([
      [100, 30],
      [120, 40],
    ])
    session.kill()
  })
})

describe('TerminalSession title', () => {
  it('promotes an OSC title into terminal_title_changed and the snapshot', async () => {
    const { session, pty, events } = makeSession()
    pty.emitData('\x1b]0;npm run dev\x07')
    await tick(20)
    expect(events.find((e) => e.type === 'terminal_title_changed')).toMatchObject({
      type: 'terminal_title_changed',
      terminalId: 't1',
      title: 'npm run dev',
    })
    expect(session.title).toBe('npm run dev')
    const snap = await session.snapshot('local')
    expect(snap.title).toBe('npm run dev')
    session.kill()
  })
})

describe('TerminalSession kill', () => {
  it('emits terminal_exited immediately so other clients can drop the tab', () => {
    const { session, events } = makeSession()
    session.kill()
    expect(events.find((e) => e.type === 'terminal_exited')).toMatchObject({
      type: 'terminal_exited',
      terminalId: 't1',
    })
    expect(session.status).toBe('exited')
  })
})

describe('TerminalSession exit', () => {
  it('emits terminal_exited and kills the pty', async () => {
    const { session, pty, events } = makeSession()
    pty.emitExit(137)
    expect(events.find((e) => e.type === 'terminal_exited')).toMatchObject({
      type: 'terminal_exited',
      exitCode: 137,
    })
    expect(session.status).toBe('exited')
  })
})

describe('TerminalSession snapshot barrier', () => {
  it('flushes pending output before the snapshot and starts the next window past lastSeq', async () => {
    const { session, pty, events } = makeSession({ coalesceMs: 50 })
    pty.emitData('hello')
    await tick(60)
    events.length = 0

    pty.emitData('world')
    const snap = await session.snapshot('local')

    const types = events.map((e) => e.type)
    const outIdx = types.indexOf('terminal_output')
    const snapIdx = types.findIndex((t) => t === 'terminal_snapshot' || t === 'terminal_snapshot_chunk')
    expect(outIdx).toBeGreaterThanOrEqual(0)
    expect(snapIdx).toBeGreaterThan(outIdx)

    const pre = events[outIdx] as Extract<TerminalEvent, { type: 'terminal_output' }>
    expect(pre).toMatchObject({ data: 'world', fromSeq: 2, toSeq: 2 })
    expect(snap.lastSeq).toBe(2)
    expect(snap.writableByMe).toBe(true)

    events.length = 0
    pty.emitData('!')
    await tick(60)
    const after = events.find((e) => e.type === 'terminal_output') as Extract<
      TerminalEvent,
      { type: 'terminal_output' }
    >
    expect(after.fromSeq).toBe(3)
    expect(after.fromSeq).toBeGreaterThan(snap.lastSeq)
    session.kill()
  })

  it('captures written text in the serialized snapshot', async () => {
    const { session, pty } = makeSession()
    pty.emitData('SENTINEL_TEXT')
    await tick(20)
    const snap = await session.snapshot('local')
    expect(session.lastAnsi).toContain('SENTINEL_TEXT')
    expect(snap.terminalId).toBe('t1')
    session.kill()
  })
})

describe('TerminalSession snapshot chunking', () => {
  it('splits an oversized snapshot into reassemblable chunks', async () => {
    const { session, pty, events } = makeSession({ snapshotSoftLimit: 8 })
    pty.emitData('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    await tick(20)
    events.length = 0
    await session.snapshot('local')

    const chunks = events.filter(
      (e) => e.type === 'terminal_snapshot_chunk',
    ) as Array<Extract<TerminalEvent, { type: 'terminal_snapshot_chunk' }>>
    expect(chunks.length).toBeGreaterThan(1)
    expect(events.find((e) => e.type === 'terminal_snapshot')).toBeUndefined()

    const total = chunks[0].total
    expect(chunks).toHaveLength(total)
    expect(chunks[0].index).toBe(0)
    expect(chunks[0].snapshot).toBeDefined()
    const ids = new Set(chunks.map((c) => c.snapshotId))
    expect(ids.size).toBe(1)

    const reassembled = [...chunks]
      .sort((a, b) => a.index - b.index)
      .map((c) => c.ansi)
      .join('')
    expect(reassembled).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    session.kill()
  })
})

describe('TerminalSession agent view', () => {
  it('renders the visible screen and the scrollback tail as plain text', async () => {
    const { session, pty } = makeSession()
    for (let i = 1; i <= 30; i++) pty.emitData(`\x1b[32mline ${i}\x1b[0m\r\n`)
    const screen = await session.screenLines()
    // 30 lines + the cursor row into 24 rows: the viewport starts at line 8.
    expect(screen[0]).toBe('line 8')
    expect(screen).toHaveLength(23)
    expect(screen.join('')).not.toContain('\x1b')
    const tail = await session.bufferTail(5)
    expect(tail.lines).toEqual(['line 27', 'line 28', 'line 29', 'line 30'])
    expect(tail.totalLines).toBe(31)
    session.kill()
  })

  it('reports the alternate screen and application cursor mode', async () => {
    const { session, pty } = makeSession()
    expect(session.altScreen).toBe(false)
    pty.emitData('\x1b[?1049h\x1b[?1h')
    await session.screenLines()
    expect(session.altScreen).toBe(true)
    expect(session.applicationCursor).toBe(true)
    session.kill()
  })

  it('tracks the foreground process against the spawn shell', () => {
    const { session, pty } = makeSession()
    expect(session.isAtShell()).toBe(true)
    pty.foreground = '-zsh'
    expect(session.isAtShell()).toBe(true)
    pty.foreground = 'node'
    expect(session.isAtShell()).toBe(false)
    expect(session.foregroundProcess()).toBe('node')
    session.kill()
  })

  it('only writes agent input while that session holds control', () => {
    const { session, pty, events } = makeSession()
    expect(session.agentInput('s1', 'x')).toBe(false)
    session.control.grant({ sessionId: 's1', command: 'python3', startedAt: Date.now() })
    expect(session.agentInput('s2', 'x')).toBe(false)
    expect(session.agentInput('s1', 'print(1)\r')).toBe(true)
    expect(pty.writes).toEqual(['print(1)\r'])
    expect(session.listItem().agentControl?.command).toBe('python3')

    session.takeOver()
    expect(session.agentInput('s1', 'y')).toBe(false)
    expect(events.filter((e) => e.type === 'terminal_control_changed').map((e) => (e as { reason: string }).reason))
      .toEqual(['granted', 'user_took_over'])
    session.kill()
  })
})
