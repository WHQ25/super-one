import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { wireBridgeShutdown } from './superone-mcp-stdio-shutdown'

describe('bridge shutdown wiring', () => {
  const setup = () => {
    const stdin = new EventEmitter()
    const transport: { onclose?: () => void } = {}
    const ipc: { onClose: (() => void) | null } = { onClose: null }
    const exit = vi.fn()
    wireBridgeShutdown({ stdin, transport, ipc, exit })
    return { stdin, transport, ipc, exit }
  }

  it('exits when stdin emits end after the parent Codex process dies', () => {
    const { stdin, exit } = setup()
    stdin.emit('end')
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('exits when stdin closes after the parent process is killed abruptly', () => {
    const { stdin, exit } = setup()
    stdin.emit('close')
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('exits when the MCP stdio transport closes', () => {
    const { transport, exit } = setup()
    transport.onclose?.()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('exits when the IPC socket to the main process closes', () => {
    const { ipc, exit } = setup()
    ipc.onClose?.()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('exits at most once when several shutdown triggers fire together', () => {
    const { stdin, transport, ipc, exit } = setup()
    stdin.emit('end')
    stdin.emit('close')
    transport.onclose?.()
    ipc.onClose?.()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
