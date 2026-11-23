import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPeekDeepseekRuntime,
  mockReadClientPluginEntries,
  mockWindows,
} = vi.hoisted(() => ({
  mockPeekDeepseekRuntime: vi.fn(),
  mockReadClientPluginEntries: vi.fn(),
  mockWindows: { list: [] as Array<{ isDestroyed: () => boolean; webContents: { isDestroyed: () => boolean; getURL: () => string; send: ReturnType<typeof vi.fn> } }> },
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => mockWindows.list,
  },
}))

vi.mock('./deepseek-runtime-host', () => ({
  dshPluginRoot: () => '/tmp/dsh-plugins',
  peekDeepseekRuntime: () => mockPeekDeepseekRuntime(),
}))

vi.mock('@superone/deepseek', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superone/deepseek')>()
  return {
    ...actual,
    readClientPluginEntries: (...args: unknown[]) => mockReadClientPluginEntries(...args),
  }
})

import {
  attachPluginRpcEvents,
  broadcastDshPluginsChanged,
  invokeDshPluginRpc,
  listDshClientPlugins,
} from './plugin-bridge'
import { PluginRpcNotFoundError } from '@superone/deepseek'

beforeEach(() => {
  vi.clearAllMocks()
  mockWindows.list = []
})

describe('plugin-bridge', () => {
  it('fails closed with runtime_not_running when peekDeepseekRuntime() is null', async () => {
    mockPeekDeepseekRuntime.mockResolvedValue(null)
    const res = await invokeDshPluginRpc('@acme/demo', 'ping', { x: 1 })
    expect(res).toEqual({
      ok: false,
      error: {
        code: 'runtime_not_running',
        message: 'DeepSeek runtime is not running',
      },
    })
  })

  it('lists client plugins purely from disk without invoking runtime', async () => {
    mockReadClientPluginEntries.mockResolvedValue({ entries: [], problems: [] })
    const res = await listDshClientPlugins()
    expect(res).toEqual({ entries: [], problems: [] })
    expect(mockPeekDeepseekRuntime).not.toHaveBeenCalled()
  })

  it('returns structured ok/error envelopes and enforces timeout', async () => {
    const invoke = vi.fn().mockResolvedValue({ pong: true })
    mockPeekDeepseekRuntime.mockResolvedValue({
      context: { get: () => ({ invoke }) },
    })

    await expect(invokeDshPluginRpc('p1', 'ping', { a: 1 })).resolves.toEqual({
      ok: true,
      data: { pong: true },
    })

    invoke.mockRejectedValueOnce(new PluginRpcNotFoundError('p1', 'missing'))
    await expect(invokeDshPluginRpc('p1', 'missing')).resolves.toEqual({
      ok: false,
      error: {
        code: 'method_not_found',
        message: 'Plugin RPC method not registered: p1#missing',
      },
    })

    invoke.mockImplementationOnce(() => new Promise(() => {}))
    await expect(invokeDshPluginRpc('p1', 'hang', undefined, 10)).resolves.toMatchObject({
      ok: false,
      error: { code: 'rpc_error' },
    })
  })

  it('broadcasts only to live business windows, skipping destroyed and auxiliary windows', () => {
    const mainSend = vi.fn()
    const dragSend = vi.fn()
    const floatSend = vi.fn()
    const destroyedSend = vi.fn()
    mockWindows.list = [
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, getURL: () => 'superone-renderer://app/index.html', send: mainSend },
      },
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, getURL: () => 'superone-renderer://app/index.html?mode=dragpreview', send: dragSend },
      },
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, getURL: () => 'superone-renderer://app/index.html?mode=computer-use-permissions', send: floatSend },
      },
      {
        isDestroyed: () => true,
        webContents: { isDestroyed: () => true, getURL: () => 'superone-renderer://app/index.html', send: destroyedSend },
      },
    ]

    broadcastDshPluginsChanged()
    expect(mainSend).toHaveBeenCalledWith('dsh:plugins-changed')
    expect(dragSend).not.toHaveBeenCalled()
    expect(floatSend).not.toHaveBeenCalled()
    expect(destroyedSend).not.toHaveBeenCalled()

    let capturedCb: ((msg: unknown) => void) | undefined
    const unsub = attachPluginRpcEvents({
      context: {
        get: () => ({
          subscribe: (cb: (msg: unknown) => void) => {
            capturedCb = cb
            return () => {}
          },
        }),
      },
    } as never)
    capturedCb?.({ pluginId: 'p1', event: 'tick', payload: 99 })
    expect(mainSend).toHaveBeenCalledWith('dsh:plugin-rpc-event', { pluginId: 'p1', event: 'tick', payload: 99 })
    expect(dragSend).not.toHaveBeenCalled()
    unsub()
  })
})
