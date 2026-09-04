import { describe, expect, it, vi } from 'vitest'
import { TerminalRuntime } from './terminal-runtime'

const snapshot = {
  terminalId: 'term-1',
  cwd: '/project',
  title: 'shell',
  status: 'running' as const,
  cols: 80,
  rows: 24,
  lastSeq: 1,
  ownerDeviceId: 'mobile',
  writableByMe: true,
  subscriberCount: 1,
}

function setup() {
  const send = vi.fn()
  const paints: unknown[] = []
  const runtime = new TerminalRuntime({ send } as never, (next) => paints.push(...next))
  runtime.ingest({ type: 'terminal_snapshot', terminalId: 'term-1', snapshot, ansi: '$ ' })
  return { runtime, send, paints }
}

describe('TerminalRuntime WebView bridge', () => {
  it('forwards xterm input and bounded resize commands', () => {
    const { runtime, send } = setup()
    runtime.handleViewMessage(JSON.stringify({ type: 'terminalInput', data: 'ls\r' }))
    runtime.handleViewMessage(JSON.stringify({ type: 'terminalResize', cols: 120, rows: 42 }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'terminal_input', terminalId: 'term-1', data: 'ls\r' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'terminal_resize', terminalId: 'term-1', cols: 120, rows: 42 })
  })

  it('ignores malformed, out-of-range, and read-only input', () => {
    const { runtime, send } = setup()
    runtime.handleViewMessage('{')
    runtime.handleViewMessage({ type: 'terminalResize', cols: 0, rows: 24 })
    runtime.handleViewMessage({ type: 'terminalResize', cols: 80.5, rows: 24 })
    runtime.handleViewMessage({ type: 'terminalResize', cols: '80', rows: 24 })
    runtime.ingest({ type: 'terminal_owner_changed', terminalId: 'term-1', ownerDeviceId: 'desktop', writableByMe: false })
    runtime.handleViewMessage({ type: 'terminalInput', data: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('resubscribes after the WebView is ready so an early snapshot is replayed', () => {
    const { runtime, send } = setup()
    runtime.handleViewMessage({ type: 'terminalReady' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_subscribe',
      terminalId: 'term-1',
      requestId: expect.any(String),
    }))
  })
})
