import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Options, WarmQuery } from '@anthropic-ai/claude-agent-sdk'

const startupMock = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  startup: (...args: unknown[]) => startupMock(...args),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('./event-trace', () => ({
  trace: vi.fn(),
}))

import { WarmupManager } from './warmup-manager'

function fakeWarm(): WarmQuery & { _closed: boolean } {
  const obj = {
    _closed: false,
    query: vi.fn(),
    close: vi.fn(function (this: { _closed: boolean }) { this._closed = true }),
    [Symbol.asyncDispose]: vi.fn(async () => {}),
  } as unknown as WarmQuery & { _closed: boolean }
  return obj
}

function baseOpts(overrides: Partial<Options> = {}): Options {
  return {
    cwd: '/tmp/proj',
    model: 'claude-sonnet-4-6',
    permissionMode: 'default',
    ...overrides,
  } as Options
}

describe('WarmupManager.keyOf', () => {
  it('produces identical keys for semantically equal options', () => {
    const a = baseOpts({ additionalDirectories: ['/a', '/b'], env: { B: '2', A: '1' } as Options['env'] })
    const b = baseOpts({ additionalDirectories: ['/b', '/a'], env: { A: '1', B: '2' } as Options['env'] })
    expect(WarmupManager.keyOf(a)).toBe(WarmupManager.keyOf(b))
  })

  it('differs when cwd / effort changes', () => {
    const k0 = WarmupManager.keyOf(baseOpts())
    expect(k0).not.toBe(WarmupManager.keyOf(baseOpts({ cwd: '/other' })))
    expect(k0).not.toBe(WarmupManager.keyOf(baseOpts({ effort: 'high' as Options['effort'] })))
  })

  it('ignores model field (model is runtime-switchable via setModel)', () => {
    const k0 = WarmupManager.keyOf(baseOpts({ model: 'claude-sonnet-4-6' }))
    const k1 = WarmupManager.keyOf(baseOpts({ model: 'claude-opus-4-7' }))
    expect(k0).toBe(k1)
  })

  it('differs when env value changes', () => {
    const a = WarmupManager.keyOf(baseOpts({ env: { ANTHROPIC_API_KEY: 'k1' } as Options['env'] }))
    const b = WarmupManager.keyOf(baseOpts({ env: { ANTHROPIC_API_KEY: 'k2' } as Options['env'] }))
    expect(a).not.toBe(b)
  })

  it('treats missing additionalDirectories the same as empty array', () => {
    expect(WarmupManager.keyOf(baseOpts())).toBe(WarmupManager.keyOf(baseOpts({ additionalDirectories: [] })))
  })
})

describe('WarmupManager prewarm/consume', () => {
  beforeEach(() => {
    startupMock.mockReset()
  })

  it('returns null when no slot exists', () => {
    const m = new WarmupManager()
    expect(m.consume(baseOpts())).toBeNull()
  })

  it('consumes the slot once startup resolves', async () => {
    const warm = fakeWarm()
    startupMock.mockResolvedValue(warm)
    const m = new WarmupManager()
    m.prewarm(baseOpts())
    await new Promise((r) => setTimeout(r, 0))
    const result = m.consume(baseOpts())
    expect(result).toBe(warm)
    expect(m.consume(baseOpts())).toBeNull()
  })

  it('skips re-prewarm when key already inflight', async () => {
    let resolveStartup: (w: WarmQuery) => void = () => {}
    startupMock.mockImplementation(() => new Promise<WarmQuery>((r) => { resolveStartup = r }))
    const m = new WarmupManager()
    m.prewarm(baseOpts())
    m.prewarm(baseOpts())
    m.prewarm(baseOpts())
    expect(startupMock).toHaveBeenCalledTimes(1)
    resolveStartup(fakeWarm())
  })

  it('replaces slot when key changes (closes old)', async () => {
    const warmA = fakeWarm()
    const warmB = fakeWarm()
    startupMock.mockResolvedValueOnce(warmA).mockResolvedValueOnce(warmB)
    const m = new WarmupManager()
    m.prewarm(baseOpts({ effort: 'low' as Options['effort'] }))
    await new Promise((r) => setTimeout(r, 0))
    m.prewarm(baseOpts({ effort: 'high' as Options['effort'] }))
    await new Promise((r) => setTimeout(r, 0))
    expect(warmA._closed).toBe(true)
    expect(m.consume(baseOpts({ effort: 'high' as Options['effort'] }))).toBe(warmB)
  })

  it('closes warm produced by superseded inflight startup', async () => {
    let resolveA: (w: WarmQuery) => void = () => {}
    const warmA = fakeWarm()
    const warmB = fakeWarm()
    startupMock
      .mockImplementationOnce(() => new Promise<WarmQuery>((r) => { resolveA = r }))
      .mockResolvedValueOnce(warmB)
    const m = new WarmupManager()
    m.prewarm(baseOpts({ effort: 'low' as Options['effort'] }))
    m.prewarm(baseOpts({ effort: 'high' as Options['effort'] }))
    resolveA(warmA)
    await new Promise((r) => setTimeout(r, 0))
    expect(warmA._closed).toBe(true)
  })

  it('dispose closes the slot and rejects future consume', async () => {
    const warm = fakeWarm()
    startupMock.mockResolvedValue(warm)
    const m = new WarmupManager()
    m.prewarm(baseOpts())
    await new Promise((r) => setTimeout(r, 0))
    m.dispose()
    expect(warm._closed).toBe(true)
    expect(m.consume(baseOpts())).toBeNull()
  })
})
