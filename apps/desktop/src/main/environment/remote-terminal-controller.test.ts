import { describe, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import type { EnvironmentHost } from './environment-host'
import { RemoteTerminalController } from './remote-terminal-controller'

describe('RemoteTerminalController', () => {
  it('routes remote terminal lifecycle and emits existing terminal events', async () => {
    const events: TerminalEvent[] = []
    const host = {
      getSession: vi.fn(async () => ({ cwd: '/srv/project/worktree' })),
      createRemoteTerminal: vi.fn(async () => ({
        terminalId: 'node-terminal',
      })),
      attachRemoteTerminal: vi.fn(async () => ({
        snapshot: 'snapshot',
        sequence: '1',
      })),
      readRemoteTerminal: vi
        .fn()
        .mockResolvedValueOnce({
          data: 'hello',
          fromSequence: '1',
          sequence: '1',
          reset: false,
          status: 'running',
          exitCode: null,
        })
        .mockResolvedValue({
          data: '',
          fromSequence: '1',
          sequence: '1',
          reset: false,
          status: 'running',
          exitCode: null,
        }),
      writeRemoteTerminal: vi.fn(async () => {}),
      resizeRemoteTerminal: vi.fn(async () => {}),
      killRemoteTerminal: vi.fn(async () => {}),
    } as unknown as EnvironmentHost
    const controller = new RemoteTerminalController({
      getHost: () => host,
      onEvent: (event) => events.push(event),
      pollMs: 5,
    })

    const item = await controller.create({
      projectPath: 'remote:connection:/srv/project',
      sessionId: 'session-1',
    })
    expect(item.terminalId).toBe('remote-terminal:connection:node-terminal')
    expect(item.cwd).toBe('/srv/project/worktree')
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'terminal_output')).toBe(true)
    })

    const snapshot = await controller.snapshot(item.terminalId)
    expect(snapshot?.lastSeq).toBe(1)
    expect(events.at(-1)).toMatchObject({
      type: 'terminal_snapshot',
      ansi: 'snapshot',
    })

    await controller.write(item.terminalId, 'pwd\r')
    await controller.resize(item.terminalId, 120, 40)
    expect(host.writeRemoteTerminal).toHaveBeenCalledWith('connection', 'node-terminal', 'pwd\r')
    expect(host.resizeRemoteTerminal).toHaveBeenCalledWith('connection', 'node-terminal', 120, 40)

    await controller.kill(item.terminalId)
    expect(host.killRemoteTerminal).toHaveBeenCalledWith('connection', 'node-terminal')
    expect(controller.has(item.terminalId)).toBe(false)
    controller.dispose()
  })
})
