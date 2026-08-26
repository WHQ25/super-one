import { EventEmitter } from 'events'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type IpcListener = (event: { sender: FakeWebContents }, payload: unknown) => void

const mocks = vi.hoisted(() => {
  const ipcListeners = new Map<string, IpcListener>()
  const contents = new Map<number, FakeWebContents>()
  const browserSession = { registerPreloadScript: vi.fn() }
  return {
    ipcListeners,
    contents,
    browserSession,
    fromPartition: vi.fn(() => browserSession),
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, listener: IpcListener) => {
      mocks.ipcListeners.set(channel, listener)
    }),
  },
  session: { fromPartition: mocks.fromPartition },
  webContents: { fromId: vi.fn((id: number) => mocks.contents.get(id) ?? null) },
}))

vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({ webmcpEnabled: false }),
}))

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn()
  destroyed = false

  constructor(
    readonly id: number,
    readonly session: object,
    private url = 'https://example.com/page',
  ) {
    super()
  }

  getURL(): string {
    return this.url
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

const {
  getWebMcpTools,
  initBrowserWebmcp,
  invokeWebMcpTool,
} = await import('./browser-webmcp')

function browserContents(id: number, url?: string): FakeWebContents {
  const wc = new FakeWebContents(id, mocks.browserSession, url)
  mocks.contents.set(id, wc)
  return wc
}

function emitIpc(channel: string, wc: FakeWebContents, payload: unknown): void {
  const listener = mocks.ipcListeners.get(channel)
  if (!listener) throw new Error(`Missing IPC listener for ${channel}`)
  listener({ sender: wc }, payload)
}

function tool(name: string): Record<string, unknown> {
  return {
    name,
    description: `Description for ${name}`,
    inputSchema: '{"type":"object"}',
  }
}

beforeAll(() => {
  initBrowserWebmcp()
})

describe('browser WebMCP registry', () => {
  it('registers a session preload for browser frames', () => {
    expect(mocks.browserSession.registerPreloadScript).toHaveBeenCalledWith({
      id: 'webmcp',
      type: 'frame',
      filePath: expect.stringMatching(/preload\/webmcp-preload\.js$/),
    })
  })

  it('drops syncs from a different session', () => {
    const wc = new FakeWebContents(101, {})
    emitIpc('webmcp:sync', wc, { tools: [tool('wrong-session')] })
    expect(getWebMcpTools(wc.id)).toBeNull()
  })

  it('full-replaces tools and derives origin from the sender URL', () => {
    const wc = browserContents(102, 'https://example.com/path?reported=wrong')
    emitIpc('webmcp:sync', wc, {
      href: 'https://attacker.invalid/',
      tools: [tool('first'), tool('second')],
    })
    expect(getWebMcpTools(wc.id)).toEqual({
      origin: 'https://example.com',
      tools: [tool('first'), tool('second')],
    })

    emitIpc('webmcp:sync', wc, { tools: [tool('replacement')] })
    expect(getWebMcpTools(wc.id)?.tools).toEqual([tool('replacement')])
    expect(wc.listenerCount('did-navigate')).toBe(1)
    expect(wc.listenerCount('destroyed')).toBe(1)
    wc.emit('destroyed')
  })

  it('drops malformed entries and caps a full sync at 64 tools', () => {
    const malformed = [
      null,
      { ...tool(''), name: '' },
      { ...tool('x'.repeat(129)), name: 'x'.repeat(129) },
      { ...tool('bad-description'), description: 42 },
      { ...tool('long-description'), description: 'x'.repeat(1025) },
      { ...tool('bad-schema'), inputSchema: {} },
      { ...tool('large-schema'), inputSchema: 'é'.repeat(4097) },
    ]
    const malformedWc = browserContents(103)
    emitIpc('webmcp:sync', malformedWc, { tools: malformed })
    expect(getWebMcpTools(malformedWc.id)?.tools).toEqual([])

    const cappedWc = browserContents(104)
    emitIpc('webmcp:sync', cappedWc, {
      tools: Array.from({ length: 70 }, (_, index) => tool(`tool-${index}`)),
    })
    expect(getWebMcpTools(cappedWc.id)?.tools).toHaveLength(64)
    malformedWc.emit('destroyed')
    cappedWc.emit('destroyed')
  })

  it('clears registry entries on navigation and destruction', () => {
    const wc = browserContents(105)
    emitIpc('webmcp:sync', wc, { tools: [tool('navigate-away')] })
    wc.emit('did-navigate')
    expect(getWebMcpTools(wc.id)).toBeNull()

    emitIpc('webmcp:sync', wc, { tools: [tool('destroy-away')] })
    wc.emit('destroyed')
    expect(getWebMcpTools(wc.id)).toBeNull()
  })
})

describe('browser WebMCP invocation', () => {
  it('sends JSON-string input and ignores a result from the wrong sender', async () => {
    const wc = browserContents(201)
    const wrong = browserContents(202)
    const resultPromise = invokeWebMcpTool(wc.id, 'add-todo', { text: 'ship it' })
    const request = wc.send.mock.calls[0][1] as {
      invocationId: string
      toolName: string
      inputJson: string
    }
    expect(wc.send).toHaveBeenCalledWith('webmcp:invoke', {
      invocationId: expect.any(String),
      toolName: 'add-todo',
      inputJson: '{"text":"ship it"}',
    })

    let settled = false
    void resultPromise.finally(() => { settled = true })
    emitIpc('webmcp:result', wrong, {
      invocationId: request.invocationId,
      ok: true,
      outputJson: '{"wrong":true}',
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    emitIpc('webmcp:result', wc, {
      invocationId: request.invocationId,
      ok: true,
      outputJson: '{"content":[{"type":"text","text":"done"}]}',
    })
    await expect(resultPromise).resolves.toEqual({
      outputJson: '{"content":[{"type":"text","text":"done"}]}',
    })
    wc.emit('destroyed')
    wrong.emit('destroyed')
  })

  it('rejects an invocation when it times out', async () => {
    const wc = browserContents(203)
    await expect(invokeWebMcpTool(wc.id, 'slow-tool', {}, { timeoutMs: 5 }))
      .rejects.toThrow('WebMCP invocation timed out after 5ms')
    wc.emit('destroyed')
  })

  it('rejects pending invocations when the page is destroyed', async () => {
    const wc = browserContents(204)
    const resultPromise = invokeWebMcpTool(wc.id, 'gone-tool', {})
    wc.emit('destroyed')
    await expect(resultPromise).rejects.toThrow('Browser view was destroyed')
  })
})
