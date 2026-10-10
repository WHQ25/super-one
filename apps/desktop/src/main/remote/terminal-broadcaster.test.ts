import { describe, expect, it, vi } from 'vitest'
import { TerminalBroadcaster } from './terminal-broadcaster'

describe('TerminalBroadcaster', () => {
  it('sends list metadata to every paired device, not just the terminal\'s watchers', () => {
    const send = vi.fn(async () => {})
    const broadcaster = new TerminalBroadcaster({ sendTerminalFrame: send })
    broadcaster.deliver({ type: 'terminal_title_changed', terminalId: 't1', title: 'npm run dev' }, ['phone'])
    broadcaster.deliver({ type: 'terminal_exited', terminalId: 't1', exitCode: 0, signal: null }, ['phone'])
    expect(send.mock.calls).toEqual([
      [{ type: 'terminal_title_changed', terminalId: 't1', title: 'npm run dev' }],
      [{ type: 'terminal_exited', terminalId: 't1', exitCode: 0, signal: null }],
    ])
  })

  it('sends output to the devices the topic reached, and nothing when none', () => {
    const send = vi.fn(async () => {})
    const broadcaster = new TerminalBroadcaster({ sendTerminalFrame: send })
    const output = { type: 'terminal_output', terminalId: 't1', data: 'x', fromSeq: 1, toSeq: 1, createdAt: 0 } as const
    broadcaster.deliver(output, ['a', 'b'])
    broadcaster.deliver(output, [])
    expect(send.mock.calls).toEqual([[output, ['a', 'b']]])
  })

  it('tells each device whether it may write after an owner change', () => {
    const send = vi.fn(async () => {})
    const broadcaster = new TerminalBroadcaster({ sendTerminalFrame: send })
    broadcaster.deliver({ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'a', writableByMe: false }, ['a', 'b'])
    expect(send.mock.calls).toEqual([
      [{ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'a', writableByMe: true }, ['a']],
      [{ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'a', writableByMe: false }, ['b']],
    ])
  })

  it('leaves answers and snapshots to the asking device', () => {
    const send = vi.fn(async () => {})
    new TerminalBroadcaster({ sendTerminalFrame: send }).deliver({ type: 'terminal_command_result', requestId: 'r', ok: true }, ['a'])
    expect(send).not.toHaveBeenCalled()
  })
})
