import { describe, expect, it, vi } from 'vitest'
import { TerminalBroadcaster } from './terminal-broadcaster'
import { TerminalManager } from '../terminal/terminal-manager'
import type { PtyLike, PtySpawner } from '../terminal/pty'

function fakeSpawner(): PtySpawner {
  return {
    spawn: (): PtyLike => ({
      write: () => {},
      resize: () => {},
      onData: () => {},
      onExit: () => {},
      kill: () => {},
      foregroundProcess: () => 'zsh',
    }),
  }
}

describe('TerminalBroadcaster title changes', () => {
  it('sends title changes to every paired device, not just PTY subscribers', async () => {
    const send = vi.fn(async () => {})
    const manager = new TerminalManager({ spawner: fakeSpawner(), onEvent: () => {} })
    const term = manager.create({ cwd: '/p', title: 'bash' })
    const broadcaster = new TerminalBroadcaster(manager, { sendTerminalFrame: send })

    await broadcaster.broadcast({
      type: 'terminal_title_changed',
      terminalId: term.terminalId,
      title: 'npm run dev',
    })

    expect(send).toHaveBeenCalledWith({
      type: 'terminal_title_changed',
      terminalId: term.terminalId,
      title: 'npm run dev',
    })
    expect(send.mock.calls[0]).toHaveLength(1)
  })

  it('broadcasts newly created terminals to every paired device', async () => {
    const send = vi.fn(async () => {})
    const manager = new TerminalManager({ spawner: fakeSpawner(), onEvent: () => {} })
    const term = manager.create({ cwd: '/p', title: 'bash' })
    const broadcaster = new TerminalBroadcaster(manager, { sendTerminalFrame: send })
    const item = term.listItem()

    await broadcaster.broadcast({ type: 'terminal_created', terminalId: term.terminalId, item })

    expect(send).toHaveBeenCalledWith({
      type: 'terminal_created',
      terminalId: term.terminalId,
      item,
    })
  })

  it('broadcasts exits to every paired device so close stays in sync', async () => {
    const send = vi.fn(async () => {})
    const manager = new TerminalManager({ spawner: fakeSpawner(), onEvent: () => {} })
    const term = manager.create({ cwd: '/p', title: 'bash' })
    const broadcaster = new TerminalBroadcaster(manager, { sendTerminalFrame: send })

    await broadcaster.broadcast({
      type: 'terminal_exited',
      terminalId: term.terminalId,
      exitCode: 0,
      signal: null,
    })

    expect(send).toHaveBeenCalledWith({
      type: 'terminal_exited',
      terminalId: term.terminalId,
      exitCode: 0,
      signal: null,
    })
  })
})
