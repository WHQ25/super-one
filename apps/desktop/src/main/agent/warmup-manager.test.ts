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

  it('differs when model changes so the first turn never inherits a stale warm model', () => {
    const k0 = WarmupManager.keyOf(baseOpts({ model: 'claude-sonnet-4-6' }))
    const k1 = WarmupManager.keyOf(baseOpts({ model: 'claude-opus-4-8' }))
    expect(k0).not.toBe(k1)
  })

  it('differs when env value changes', () => {
    const a = WarmupManager.keyOf(baseOpts({ env: { ANTHROPIC_API_KEY: 'k1' } as Options['env'] }))
    const b = WarmupManager.keyOf(baseOpts({ env: { ANTHROPIC_API_KEY: 'k2' } as Options['env'] }))
    expect(a).not.toBe(b)
  })

  it('treats missing additionalDirectories the same as empty array', () => {
    expect(WarmupManager.keyOf(baseOpts())).toBe(WarmupManager.keyOf(baseOpts({ additionalDirectories: [] })))
  })

  it('differs when resume / resumeSessionAt / resumeDropsTurn / forkSession / sessionId changes', () => {
    const fresh = WarmupManager.keyOf(baseOpts())
    expect(fresh).not.toBe(WarmupManager.keyOf(baseOpts({ resume: 'sess-abc' } as Partial<Options>)))
    expect(fresh).not.toBe(WarmupManager.keyOf(baseOpts({ resumeSessionAt: 'uuid-1' } as Partial<Options>)))
    expect(fresh).not.toBe(WarmupManager.keyOf(baseOpts({ resumeDropsTurn: 'drop-uuid' } as Partial<Options>)))
    expect(fresh).not.toBe(WarmupManager.keyOf(baseOpts({ forkSession: true } as Partial<Options>)))
    expect(fresh).not.toBe(WarmupManager.keyOf(baseOpts({ sessionId: 'sess-xyz' } as Partial<Options>)))
    const a = WarmupManager.keyOf(baseOpts({ resume: 'sess-a' } as Partial<Options>))
    const b = WarmupManager.keyOf(baseOpts({ resume: 'sess-b' } as Partial<Options>))
    expect(a).not.toBe(b)
    const at = WarmupManager.keyOf(baseOpts({ resumeSessionAt: 'kept', resumeDropsTurn: 'drop-a' } as Partial<Options>))
    const bt = WarmupManager.keyOf(baseOpts({ resumeSessionAt: 'kept', resumeDropsTurn: 'drop-b' } as Partial<Options>))
    expect(at).not.toBe(bt)
  })

  it('differs when AskUserQuestion previewFormat (toolConfig) changes', () => {
    const md = WarmupManager.keyOf(baseOpts({ toolConfig: { askUserQuestion: { previewFormat: 'markdown' } } } as Partial<Options>))
    const html = WarmupManager.keyOf(baseOpts({ toolConfig: { askUserQuestion: { previewFormat: 'html' } } } as Partial<Options>))
    expect(md).not.toBe(html)
  })
})

describe('WarmupManager prewarm/consume — session isolation', () => {
  beforeEach(() => {
    startupMock.mockReset()
  })

  it('does NOT consume a fresh-session slot when the send carries resume', async () => {
    const warm = fakeWarm()
    startupMock.mockResolvedValue(warm)
    const m = new WarmupManager()
    m.prewarm(baseOpts())
    await new Promise((r) => setTimeout(r, 0))
    const result = m.consume(baseOpts({ resume: 'old-session-id' } as Partial<Options>))
    expect(result).toBeNull()
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
    expect(result?.warm).toBe(warm)
    expect(result?.abortController).toBeInstanceOf(AbortController)
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
    expect(m.consume(baseOpts({ effort: 'high' as Options['effort'] }))?.warm).toBe(warmB)
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

describe('WarmupManager subprocess cleanup (abortController ownership)', () => {
  beforeEach(() => {
    startupMock.mockReset()
  })

  it('injects an abortController into startup options when caller does not provide one', async () => {
    startupMock.mockResolvedValue(fakeWarm())
    const m = new WarmupManager()
    m.prewarm(baseOpts())
    await new Promise((r) => setTimeout(r, 0))
    const passed = startupMock.mock.calls[0][0].options
    expect(passed.abortController).toBeInstanceOf(AbortController)
    expect(passed.abortController.signal.aborted).toBe(false)
  })

  it('preserves a caller-supplied abortController instead of overwriting it', async () => {
    startupMock.mockResolvedValue(fakeWarm())
    const m = new WarmupManager()
    const callerAc = new AbortController()
    m.prewarm(baseOpts({ abortController: callerAc } as Partial<Options>))
    await new Promise((r) => setTimeout(r, 0))
    expect(startupMock.mock.calls[0][0].options.abortController).toBe(callerAc)
  })

  it('aborts the slot controller on dispose so spawn() SIGTERMs the warm subprocess', async () => {
    startupMock.mockResolvedValue(fakeWarm())
    const m = new WarmupManager()
    m.prewarm(baseOpts())
    await new Promise((r) => setTimeout(r, 0))
    const ac: AbortController = startupMock.mock.calls[0][0].options.abortController
    expect(ac.signal.aborted).toBe(false)
    m.dispose()
    expect(ac.signal.aborted).toBe(true)
  })

  it('aborts the old slot controller when key_changed forces a re-warm', async () => {
    startupMock.mockResolvedValueOnce(fakeWarm()).mockResolvedValueOnce(fakeWarm())
    const m = new WarmupManager()
    m.prewarm(baseOpts({ effort: 'low' as Options['effort'] }))
    await new Promise((r) => setTimeout(r, 0))
    const acA: AbortController = startupMock.mock.calls[0][0].options.abortController
    m.prewarm(baseOpts({ effort: 'high' as Options['effort'] }))
    await new Promise((r) => setTimeout(r, 0))
    expect(acA.signal.aborted).toBe(true)
  })

  it('aborts the controller of a superseded inflight startup', async () => {
    let resolveA: (w: WarmQuery) => void = () => {}
    startupMock
      .mockImplementationOnce(() => new Promise<WarmQuery>((r) => { resolveA = r }))
      .mockResolvedValueOnce(fakeWarm())
    const m = new WarmupManager()
    m.prewarm(baseOpts({ effort: 'low' as Options['effort'] }))
    const acA: AbortController = startupMock.mock.calls[0][0].options.abortController
    m.prewarm(baseOpts({ effort: 'high' as Options['effort'] }))
    resolveA(fakeWarm())
    await new Promise((r) => setTimeout(r, 0))
    expect(acA.signal.aborted).toBe(true)
  })
})

describe('per-backend isolation', () => {
  it('a slot prewarmed by one manager cannot be consumed by another, preventing canUseTool bleed across backends', async () => {
    const warm = fakeWarm()
    startupMock.mockResolvedValue(warm)
    const a = new WarmupManager()
    const b = new WarmupManager()
    a.prewarm(baseOpts({ cwd: '/iso-test' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(b.consume(baseOpts({ cwd: '/iso-test' }))).toBeNull()
    expect(a.consume(baseOpts({ cwd: '/iso-test' }))?.warm).toBe(warm)
  })
})
