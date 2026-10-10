import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceStatus } from '@superone/shared/realtime-voice'
import { MobileVoiceService, MicrophoneDeniedError, supportedVoice, type VoiceMedia, type VoiceMediaPort } from './voice-service'
import type { VoiceAudioLevels } from './voice-audio-levels'

const target = { projectPath: '/repo', sessionId: 'sid', title: 'Task' }
const identity = { attemptId: 'one', callId: 'call', hostEpoch: 'host', generation: 1 }
const idle: VoiceStatus = { protocol: 1, supported: true, call: null }
const active: VoiceStatus = { ...idle, call: { ...identity, ...target, owned: true, state: 'starting' } }
function fixture() {
  let state = (_: 'ready' | 'disconnected' | 'failed') => {}
  let levels = (_: VoiceAudioLevels) => {}
  const media: VoiceMedia = { offer: vi.fn(async () => 'v=0\na=offer'), answer: vi.fn(async () => {}), close: vi.fn(), inputMuted: vi.fn(), outputMuted: vi.fn(), readyCue: vi.fn() }
  const port: VoiceMediaPort = { available: () => true, open: vi.fn(async (_, fn, onLevels) => { state = fn; levels = onLevels ?? (() => {}); return media }) }
  const control = { status: vi.fn(async () => idle), start: vi.fn(async () => active), stop: vi.fn(async () => idle), ready: vi.fn(async () => active) }
  const service = new MobileVoiceService(port, () => 'one')
  return { service, media, port, control, state: (s: 'ready' | 'disconnected' | 'failed') => state(s), levels: (sample: VoiceAudioLevels) => levels(sample) }
}
afterEach(() => vi.useRealTimers())
describe('mobile voice service', () => {
  it('plays the ready cue once after acknowledged readiness and ignores reconnects', async () => {
    const f = fixture(); await f.service.start(target, f.control)
    expect(f.media.readyCue).not.toHaveBeenCalled()
    f.state('ready'); await Promise.resolve()
    expect(f.media.readyCue).toHaveBeenCalledTimes(1)
    f.state('ready'); await Promise.resolve()
    expect(f.media.readyCue).toHaveBeenCalledTimes(1)
    f.service.stop(); await Promise.resolve(); await Promise.resolve()
  })
  it('silences a UI hangup immediately but paints stopping before native teardown', async () => {
    const f = fixture(); await f.service.start(target, f.control)
    f.state('ready'); await Promise.resolve()
    let cleanup!: () => void
    f.service.stop(afterPaint => { cleanup = afterPaint })
    expect(f.service.snapshot().phase).toBe('stopping')
    expect(f.media.inputMuted).toHaveBeenLastCalledWith(true)
    expect(f.media.outputMuted).toHaveBeenLastCalledWith(true)
    expect(f.media.close).not.toHaveBeenCalled()
    expect(f.control.stop).not.toHaveBeenCalled()
    f.service.stop(() => {})
    expect(f.service.snapshot().phase).toBe('stopping')
    cleanup()
    expect(f.media.close).toHaveBeenCalledTimes(1)
    await Promise.resolve(); await Promise.resolve()
    expect(f.service.snapshot().phase).toBe('idle')
  })
  it('flushes deferred UI teardown immediately on background without double disposal', async () => {
    const f = fixture(); await f.service.start(target, f.control)
    let cleanup!: () => void
    f.service.stop(afterPaint => { cleanup = afterPaint })
    f.service.background()
    expect(f.media.close).toHaveBeenCalledTimes(1)
    cleanup()
    expect(f.control.stop).toHaveBeenCalledTimes(1)
    await Promise.resolve(); await Promise.resolve()
  })
  it('feeds actual input/output levels without chat renders, gates mutes, and fences old media', async () => {
    const f = fixture(); await f.service.start(target, f.control)
    f.levels({ input: 0.1, output: 0.2 })
    expect(f.service.audioLevels.snapshot()).toEqual({ input: 0, output: 0 })
    f.state('ready'); await Promise.resolve()
    const chatStateChanged = vi.fn()
    const unsubscribe = f.service.subscribe(chatStateChanged)
    f.levels({ input: 0.1, output: 0.2 })
    expect(f.service.audioLevels.snapshot()).toEqual({ input: 0.1, output: 0.2 })
    expect(chatStateChanged).not.toHaveBeenCalled()
    f.service.muteInput()
    expect(f.service.audioLevels.snapshot()).toEqual({ input: 0, output: 0.2 })
    f.levels({ input: 0.8, output: 0.3 })
    expect(f.service.audioLevels.snapshot()).toEqual({ input: 0, output: 0.3 })
    f.service.muteOutput()
    expect(f.service.audioLevels.snapshot()).toEqual({ input: 0, output: 0 })
    f.service.stop(); f.levels({ input: 1, output: 1 })
    expect(f.service.audioLevels.snapshot()).toEqual({ input: 0, output: 0 })
    unsubscribe(); await Promise.resolve(); await Promise.resolve()
  })
  it('reserves a new-session start once and creates its backing session before capture', async () => {
    const f = fixture()
    let created!: (value: typeof target) => void
    const prepare = vi.fn(() => new Promise<typeof target>(resolve => { created = resolve }))
    const control = vi.fn(() => f.control)
    const pending = f.service.startNew(prepare, control)
    await f.service.startNew(prepare, control)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(f.service.snapshot()).toMatchObject({ phase: 'starting', target: null })
    expect(f.port.open).not.toHaveBeenCalled()
    created(target); await pending
    expect(control).toHaveBeenCalledWith(target)
    expect(f.control.start).toHaveBeenCalledTimes(1)
    expect(f.service.snapshot().target).toEqual(target)
    f.service.stop(); await Promise.resolve(); await Promise.resolve()
  })
  it.each(['cancel', 'background', 'disconnect', 'timeout'] as const)('fences late session creation after %s', async (reason) => {
    vi.useFakeTimers()
    const f = fixture()
    let created!: (value: typeof target) => void
    let signal!: AbortSignal
    const prepare = (abort: AbortSignal) => { signal = abort; return new Promise<typeof target>(resolve => { created = resolve }) }
    const pending = f.service.startNew(prepare, () => f.control)
    if (reason === 'cancel') f.service.stop()
    else if (reason === 'background') f.service.background()
    else if (reason === 'disconnect') f.service.connection(false)
    else await vi.advanceTimersByTimeAsync(30_000)
    expect(signal.aborted).toBe(true)
    created(target); await pending
    expect(f.port.open).not.toHaveBeenCalled()
    expect(f.control.start).not.toHaveBeenCalled()
  })
  it('reports session creation failure without capture and allows a fresh attempt', async () => {
    const f = fixture()
    await f.service.startNew(async () => { throw new Error('Session creation failed') }, () => f.control)
    expect(f.service.snapshot()).toMatchObject({ phase: 'error', error: 'Session creation failed' })
    expect(f.port.open).not.toHaveBeenCalled()
    await f.service.startNew(async () => target, () => f.control)
    expect(f.control.start).toHaveBeenCalledTimes(1)
    f.service.stop(); await Promise.resolve(); await Promise.resolve()
  })
  it('requires media readiness, fences stale answers, and keeps mute controls local', async () => {
    const f = fixture(); await f.service.start(target, f.control)
    f.service.signal({ ...identity, kind: 'answer', sdp: 'answer' }, target)
    await Promise.resolve()
    expect(f.service.snapshot().phase).toBe('starting')
    expect(f.control.ready).not.toHaveBeenCalled()
    f.service.signal({ ...identity, hostEpoch: 'old', kind: 'answer', sdp: 'stale' }, target)
    expect(f.media.answer).toHaveBeenCalledTimes(1)
    f.state('ready'); await Promise.resolve()
    expect(f.service.snapshot().phase).toBe('active')
    f.service.muteInput(); f.service.muteOutput()
    expect(f.media.inputMuted).toHaveBeenCalledWith(true)
    expect(f.media.outputMuted).toHaveBeenCalledWith(true)
    expect(f.control.start).toHaveBeenCalledTimes(1)
    f.service.background()
    expect(f.media.close).toHaveBeenCalledTimes(1)
    await Promise.resolve(); await Promise.resolve()
  })
  it('cancelled permission/capture result is immediately released and never sent upstream', async () => {
    const f = fixture()
    let captured!: (value: VoiceMedia) => void
    vi.mocked(f.port.open).mockImplementation(() => new Promise(resolve => { captured = resolve }))
    const pending = f.service.start(target, f.control); await Promise.resolve()
    f.service.background(); captured(f.media); await pending
    expect(f.media.close).toHaveBeenCalledTimes(1)
    expect(f.control.start).not.toHaveBeenCalled()
    expect(f.control.stop).toHaveBeenCalledWith('one')
  })
  it('denial is visible without opening an upstream call; capability/busy preflight avoids capture', async () => {
    const f = fixture()
    vi.mocked(f.port.open).mockRejectedValue(new MicrophoneDeniedError('Denied'))
    await f.service.start(target, f.control)
    expect(f.service.snapshot().phase).toBe('denied')
    expect(f.control.start).not.toHaveBeenCalled()
    f.service.stop()
    f.control.status.mockResolvedValue({ ...active, call: { ...active.call!, owned: false } })
    await f.service.start(target, f.control)
    expect(f.port.open).toHaveBeenCalledTimes(1)
  })
  it('expires lost media/control links, checks host epoch on recovery, and never restarts automatically', async () => {
    vi.useFakeTimers()
    const f = fixture(); await f.service.start(target, f.control)
    f.state('ready'); await Promise.resolve()
    f.state('disconnected'); await vi.advanceTimersByTimeAsync(4000); f.state('ready')
    await vi.advanceTimersByTimeAsync(8000); expect(f.media.close).not.toHaveBeenCalled()
    f.service.connection(false)
    f.control.status.mockResolvedValue({ ...active, call: { ...active.call!, hostEpoch: 'replacement' } })
    f.service.connection(true); await Promise.resolve()
    expect(f.media.close).toHaveBeenCalledTimes(1)
    expect(f.service.snapshot().phase).toBe('error')
    f.service.connection(true); await vi.advanceTimersByTimeAsync(30_000)
    expect(f.control.start).toHaveBeenCalledTimes(1)
  })
  it('reconciles a previous phone process before acquiring microphone', async () => {
    const f = fixture()
    f.control.status.mockResolvedValueOnce(active).mockResolvedValueOnce(idle)
    await f.service.start(target, f.control)
    expect(f.control.stop).toHaveBeenCalledWith('one', active.call)
    expect(vi.mocked(f.port.open).mock.invocationCallOrder[0]).toBeGreaterThan(f.control.stop.mock.invocationCallOrder[0]!)
    f.service.stop(); await Promise.resolve(); await Promise.resolve()
  })
})

it('does not start a custom provider or another harness from a stale official capability', () => {
  expect(supportedVoice(idle, 'codex', 'custom-provider')).toBe(false)
  expect(supportedVoice(idle, 'claude', null)).toBe(false)
  expect(supportedVoice(idle, 'codex', 'codex-account:cli')).toBe(true)
  expect(supportedVoice(undefined, 'codex', null)).toBe(false)
})
