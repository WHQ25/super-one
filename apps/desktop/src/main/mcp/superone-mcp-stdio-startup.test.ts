import { describe, expect, it, vi } from 'vitest'
import { startBridgeRuntime } from './superone-mcp-stdio-startup'

function deferredSleep() {
  return vi.fn(async () => {})
}

describe('startBridgeRuntime', () => {
  it('loads tools then connects stdio on the happy path', async () => {
    const order: string[] = []
    const connect = vi.fn(async () => { order.push('connect') })
    const loadTools = vi.fn(async () => { order.push('load') })
    const connectStdio = vi.fn(async () => { order.push('stdio') })

    const result = await startBridgeRuntime({
      connect, loadTools, connectStdio, sleep: deferredSleep(), log: vi.fn(),
    })

    expect(result.ipcReady).toBe(true)
    expect(order).toEqual(['connect', 'load', 'stdio'])
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('retries the IPC connection on transient failure before succeeding', async () => {
    let attempts = 0
    const connect = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) throw new Error('ECONNREFUSED')
    })
    const loadTools = vi.fn(async () => {})
    const connectStdio = vi.fn(async () => {})
    const sleep = deferredSleep()

    const result = await startBridgeRuntime({
      connect, loadTools, connectStdio, sleep, log: vi.fn(), baseDelayMs: 1,
    })

    expect(result.ipcReady).toBe(true)
    expect(connect).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(connectStdio).toHaveBeenCalledTimes(1)
  })

  it('retries the initial tools load after the socket connects', async () => {
    const connect = vi.fn(async () => {})
    let loads = 0
    const loadTools = vi.fn(async () => {
      loads += 1
      if (loads < 2) throw new Error('tools/list timed out')
    })
    const connectStdio = vi.fn(async () => {})

    const result = await startBridgeRuntime({
      connect, loadTools, connectStdio, sleep: deferredSleep(), log: vi.fn(), baseDelayMs: 1,
    })

    expect(result.ipcReady).toBe(true)
    expect(loadTools).toHaveBeenCalledTimes(2)
  })

  it('still connects stdio after exhausting retries so codex gets the built-in floor', async () => {
    const connect = vi.fn(async () => { throw new Error('ENOENT') })
    const loadTools = vi.fn(async () => {})
    const connectStdio = vi.fn(async () => {})
    const log = vi.fn()

    const result = await startBridgeRuntime({
      connect, loadTools, connectStdio, sleep: deferredSleep(), log, baseDelayMs: 1, maxAttempts: 3,
    })

    expect(result.ipcReady).toBe(false)
    expect(connect).toHaveBeenCalledTimes(3)
    expect(loadTools).not.toHaveBeenCalled()
    expect(connectStdio).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('built-in tools only'))
  })

  it('connects stdio at the deadline when tools/list hangs past the startup budget', async () => {
    // Regression: the bridge tools/list request timeout (65s) exceeds codex's 60s
    // startup_timeout_sec, so a hung load must not block the stdio handshake — the
    // built-in floor must still be served before codex gives up.
    const connect = vi.fn(async () => {})
    const loadTools = vi.fn(() => new Promise<void>(() => {})) // never resolves
    const connectStdio = vi.fn(async () => {})
    const log = vi.fn()

    const result = await startBridgeRuntime({
      connect, loadTools, connectStdio, sleep: deferredSleep(), log, deadlineMs: 5,
    })

    expect(result.ipcReady).toBe(false)
    expect(connectStdio).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('deadline'))
  })

  it('never swallows a fatal stdio transport failure', async () => {
    const connect = vi.fn(async () => {})
    const loadTools = vi.fn(async () => {})
    const connectStdio = vi.fn(async () => { throw new Error('stdio dead') })

    await expect(startBridgeRuntime({
      connect, loadTools, connectStdio, sleep: deferredSleep(), log: vi.fn(),
    })).rejects.toThrow('stdio dead')
  })
})
