import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events')

  class FakeProxyChild extends Emitter {
    killed = false
    exitCode: number | null = null
    stderr = null
    stdout = null
    kill(): boolean {
      this.killed = true
      this.exitCode = null
      this.emit('exit', null, 'SIGTERM')
      return true
    }
  }

  const children: FakeProxyChild[] = []
  return { FakeProxyChild, children }
})

vi.mock('child_process', () => ({
  fork: vi.fn(() => {
    const child = new harness.FakeProxyChild()
    harness.children.push(child)
    queueMicrotask(() => child.emit('message', { type: 'listening' }))
    return child
  }),
}))

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ env: {} })),
}))
vi.mock('./resolver', () => ({
  resolveChatService: vi.fn(),
}))

import { resolveChatService } from './resolver'
import {
  clearCodexProxyCache,
  ensureCodexProxyUrl,
  getCodexProxyUrl,
  shutdownAll,
} from './llm-proxy-manager'

const IDLE_MS = 5 * 60_000
const SWEEP_MS = 60_000

function chatService() {
  return {
    protocol: 'openai-chat' as const,
    credentialId: 'cred-bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    brand: 'bailian',
    apiKey: 'sk-test',
    modelMapping: { flash: { id: 'deepseek-v4.1-flash-1017' } },
    platformId: 'bailian',
  }
}

async function startCodexProxy(): Promise<{ url: string; child: EventEmitter & { killed: boolean } }> {
  const url = await ensureCodexProxyUrl('cred-bailian')
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const child = harness.children.at(-1)
  expect(child).toBeDefined()
  return { url: url!, child: child! }
}

describe('Codex llm-proxy lifetime', () => {
  beforeEach(() => {
    vi.mocked(resolveChatService).mockReturnValue(chatService() as ReturnType<typeof resolveChatService>)
    vi.useFakeTimers()
  })

  afterEach(() => {
    shutdownAll()
    clearCodexProxyCache()
    harness.children.length = 0
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('spawns a new proxy after the idle sweep instead of reusing the dead URL', async () => {
    const { url, child } = await startCodexProxy()

    await vi.advanceTimersByTimeAsync(IDLE_MS + SWEEP_MS)

    expect(child.killed).toBe(true)
    expect(getCodexProxyUrl(null)).toBeUndefined()

    const next = await ensureCodexProxyUrl('cred-bailian')
    expect(next).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(next).not.toBe(url)
    expect(harness.children).toHaveLength(2)
    expect(harness.children[1]!.killed).toBe(false)
  })

  it('keeps the proxy alive when a later Codex turn touches it inside the idle window', async () => {
    const { url, child } = await startCodexProxy()

    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(await ensureCodexProxyUrl('cred-bailian')).toBe(url)

    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(child.killed).toBe(false)

    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(child.killed).toBe(true)
    expect(getCodexProxyUrl(null)).toBeUndefined()
  })

  it('does not sweep a proxy that still has an in-flight request', async () => {
    const { url, child } = await startCodexProxy()
    child.emit('message', { type: 'busy', delta: 1 })

    await vi.advanceTimersByTimeAsync(IDLE_MS + SWEEP_MS)
    expect(child.killed).toBe(false)
    expect(getCodexProxyUrl(null)).toBe(url)

    child.emit('message', { type: 'busy', delta: -1 })
    await vi.advanceTimersByTimeAsync(IDLE_MS + SWEEP_MS)

    expect(child.killed).toBe(true)
    expect(getCodexProxyUrl(null)).toBeUndefined()
    const next = await ensureCodexProxyUrl('cred-bailian')
    expect(next).not.toBe(url)
  })
})
