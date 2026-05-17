import { describe, it, expect } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { TerminalManager } from './terminal-manager'
import type { PtyLike, PtySpawner } from './pty'

function fakeSpawner(): PtySpawner {
  return {
    spawn: (): PtyLike => ({
      write: () => {},
      resize: () => {},
      onData: () => {},
      onExit: () => {},
      kill: () => {},
    }),
  }
}

function makeManager(exists?: (p: string) => boolean) {
  const events: TerminalEvent[] = []
  const manager = new TerminalManager({
    spawner: fakeSpawner(),
    onEvent: (e) => events.push(e),
    exists: exists ?? (() => true),
  })
  return { manager, events }
}

describe('TerminalManager lifecycle', () => {
  it('creates terminals with unique ids and lists them by cwd', () => {
    const { manager } = makeManager()
    const a = manager.create({ cwd: '/proj' })
    const b = manager.create({ cwd: '/proj' })
    expect(a.terminalId).not.toBe(b.terminalId)
    expect(manager.list('/proj').map((t) => t.terminalId).sort()).toEqual(
      [a.terminalId, b.terminalId].sort(),
    )
    expect(manager.get(a.terminalId)).toBe(a)
  })

  it('isolates terminals of a project and its worktree by effective cwd', () => {
    const { manager } = makeManager()
    manager.create({ cwd: '/proj' })
    manager.create({ cwd: '/proj/.worktrees/feat' })
    expect(manager.list('/proj')).toHaveLength(1)
    expect(manager.list('/proj/.worktrees/feat')).toHaveLength(1)
  })

  it('keeps terminals alive independent of any chat session (no session coupling)', () => {
    const { manager } = makeManager()
    const t = manager.create({ cwd: '/proj' })
    manager.create({ cwd: '/other' })
    expect(manager.get(t.terminalId)).toBe(t)
    expect(manager.list('/proj')).toHaveLength(1)
  })
})

describe('TerminalManager invalidateCwd', () => {
  it('kills all terminals under a vanished cwd and emits terminal_exited', () => {
    const { manager, events } = makeManager()
    const a = manager.create({ cwd: '/proj' })
    const b = manager.create({ cwd: '/proj' })
    manager.create({ cwd: '/keep' })

    manager.invalidateCwd('/proj')

    const exited = events
      .filter((e) => e.type === 'terminal_exited')
      .map((e) => (e as Extract<TerminalEvent, { type: 'terminal_exited' }>).terminalId)
      .sort()
    expect(exited).toEqual([a.terminalId, b.terminalId].sort())
    expect(manager.list('/proj')).toHaveLength(0)
    expect(manager.list('/keep')).toHaveLength(1)
    expect(a.status).toBe('exited')
  })
})

describe('TerminalManager cwd-missing sweep', () => {
  it('invalidates terminals whose cwd no longer exists on disk', () => {
    let present = true
    const { manager, events } = makeManager((p) => (p === '/gone' ? present : true))
    manager.create({ cwd: '/gone' })
    manager.create({ cwd: '/here' })

    manager.sweep()
    expect(events.some((e) => e.type === 'terminal_exited')).toBe(false)

    present = false
    manager.sweep()
    expect(events.some((e) => e.type === 'terminal_exited')).toBe(true)
    expect(manager.list('/gone')).toHaveLength(0)
    expect(manager.list('/here')).toHaveLength(1)
  })
})
