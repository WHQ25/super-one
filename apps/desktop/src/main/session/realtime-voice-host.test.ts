import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { Session } from './types'
import { RealtimeVoiceHost, type VoiceEndpoint } from './realtime-voice-host'

const offer = { sdp: 'v=0\r\na=ice-pwd:private-offer' }
function fixture() {
  let receive = (_: AgentEvent) => {}
  let lifecycle = (_: { type: string }) => {}
  let complete!: () => void
  const start = new Promise<void>(resolve => { complete = resolve })
  const release = vi.fn()
  const session = {
    id: 'sid', projectPath: '/repo', snapshot: { harnessId: 'codex' }, lease: { current: { leaseId: 'lease', generation: '1' }, releaseDelegate: vi.fn() },
    getApiProviderId: () => undefined, retainRealtimeVoice: vi.fn(() => release),
    onRealtimeSignal: vi.fn(fn => { receive = fn; return vi.fn() }),
    onLifecycle: vi.fn(fn => { lifecycle = fn; return vi.fn() }),
    startRealtimeVoice: vi.fn(() => start), stopRealtimeVoice: vi.fn(async () => {}),
  }
  const a: VoiceEndpoint = { id: 'phone:a', deviceId: 'a', send: vi.fn() }
  const b: VoiceEndpoint = { id: 'window:2', send: vi.fn() }
  const host = new RealtimeVoiceHost()
  return { host, session: session as unknown as Session, raw: session, a, b, complete, release, receive: (e: AgentEvent) => receive(e), lifecycle: (e: { type: string }) => lifecycle(e) }
}
afterEach(() => vi.useRealTimers())
describe('host-wide voice ownership', () => {
  it('rejects a running backing task before reserving media and permits starting after it finishes', async () => {
    const f = fixture()
    Object.assign(f.raw.snapshot, { status: 'streaming' })
    expect(f.host.status(f.session, f.a)).toMatchObject({ supported: true, startBlockedReason: expect.stringContaining('task'), call: null })
    expect(() => f.host.start(f.session, f.a, 'one', offer)).toThrow(/task is running/)
    expect(f.raw.retainRealtimeVoice).not.toHaveBeenCalled()
    Object.assign(f.raw.snapshot, { status: 'idle' })
    expect(f.host.start(f.session, f.a, 'two', offer).call).not.toBeNull()
    Object.assign(f.raw.snapshot, { status: 'streaming' })
    // Existing calls and their idempotent receipts stay usable while a task runs.
    expect(f.host.start(f.session, f.a, 'two', offer).call?.attemptId).toBe('two')
    f.complete(); await Promise.resolve(); await f.host.stop(f.session, f.a, 'two')
  })
  it('rejects a different displayed account before reserving or starting the call', () => {
    const f = fixture()
    f.session.getApiProviderId = () => 'codex-account:cli'
    expect(() => f.host.start(f.session, f.a, 'one', { ...offer, selection: { apiProviderId: 'codex-account:other' } })).toThrow(/Codex account/)
    expect(f.raw.retainRealtimeVoice).not.toHaveBeenCalled()
    expect(f.raw.startRealtimeVoice).not.toHaveBeenCalled()
  })
  it('reserves before start settles, directs SDP and rejects another endpoint stop/ready', async () => {
    const f = fixture()
    const call = f.host.start(f.session, f.a, 'one', offer).call!
    expect(() => f.host.start(f.session, f.b, 'two', offer)).toThrow(/Another voice/)
    f.receive({ type: 'realtime_sdp', sdp: 'private-answer' })
    expect(f.a.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'answer', sdp: 'private-answer', callId: call.callId, attemptId: call.attemptId, hostEpoch: call.hostEpoch }))
    expect(f.b.send).not.toHaveBeenCalled()
    await expect(f.host.stop(f.session, f.b, 'one')).rejects.toThrow(/another endpoint/)
    expect(() => f.host.ready(f.session, f.b, call)).toThrow(/no longer/)
    f.complete(); await Promise.resolve()
    await f.host.stop(f.session, f.a, 'one')
    expect(f.host.status(f.session, f.a).call).toBeNull()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('cancels pending startup, ignores its late SDP, and holds admission through stop', async () => {
    const f = fixture()
    let stopped!: () => void
    f.raw.stopRealtimeVoice.mockImplementation(() => new Promise<void>(resolve => { stopped = resolve }))
    f.host.start(f.session, f.a, 'one', offer)
    await f.host.stop(f.session, f.a, 'one')
    f.receive({ type: 'realtime_sdp', sdp: 'late-secret' })
    expect(f.a.send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'answer' }))
    f.complete(); await Promise.resolve()
    expect(f.raw.stopRealtimeVoice).toHaveBeenCalledTimes(1)
    expect(() => f.host.start(f.session, f.b, 'two', offer)).toThrow(/Another voice/)
    stopped(); await Promise.resolve(); await Promise.resolve()
    expect(f.host.status(f.session, f.a).call).toBeNull()
    expect(() => f.host.start(f.session, f.a, 'one', offer)).toThrow(/already ended/)
  })
  it('a stop arriving before start tombstones that attempt; stale stop cannot end its replacement', async () => {
    const f = fixture()
    await f.host.stop(f.session, f.a, 'one')
    expect(() => f.host.start(f.session, f.a, 'one', offer)).toThrow(/already ended/)
    f.host.start(f.session, f.a, 'two', offer)
    await f.host.stop(f.session, f.a, 'one')
    expect(f.host.status(f.session, f.a).call?.attemptId).toBe('two')
    f.complete(); await Promise.resolve(); await f.host.stop(f.session, f.a, 'two')
  })
  it('reconnect preserves interest, but an expired disconnect stops upstream', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.host.start(f.session, f.a, 'one', offer); f.complete(); await Promise.resolve()
    f.host.disconnected('a'); await vi.advanceTimersByTimeAsync(4000)
    f.host.reconnect(f.session, f.a)
    expect(f.release).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8000)
    expect(f.raw.stopRealtimeVoice).not.toHaveBeenCalled()
    f.host.disconnected('a'); await vi.advanceTimersByTimeAsync(8000)
    expect(f.raw.stopRealtimeVoice).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('stops on grant takeover and ignores SDP arriving after revocation', async () => {
    const f = fixture()
    f.host.start(f.session, f.a, 'one', offer)
    f.lifecycle({ type: 'control_changed', lease: { leaseId: 'replacement', generation: '2' } } as never)
    f.receive({ type: 'realtime_sdp', sdp: 'late-secret' })
    expect(f.a.send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'answer' }))
    f.complete(); await Promise.resolve(); await Promise.resolve()
    expect(f.raw.stopRealtimeVoice).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('ends a removed pairing immediately instead of waiting for disconnect grace', async () => {
    const f = fixture()
    f.host.start(f.session, f.a, 'one', offer); f.complete(); await Promise.resolve()
    f.host.kicked('a'); await Promise.resolve(); await Promise.resolve()
    expect(f.raw.stopRealtimeVoice).toHaveBeenCalledTimes(1)
    expect(f.raw.lease.releaseDelegate).toHaveBeenCalledWith('phone:a')
    expect(f.host.status(f.session, f.a).call).toBeNull()
  })
  it('keeps the slot on teardown failure and redacts upstream errors', async () => {
    const f = fixture()
    f.host.start(f.session, f.a, 'one', offer); f.complete(); await Promise.resolve()
    f.raw.stopRealtimeVoice.mockRejectedValue(new Error('v=0\na=ice-pwd:secret'))
    f.receive({ type: 'realtime_error', error: 'payload v=0\na=ice-pwd:secret' })
    await Promise.resolve(); await Promise.resolve()
    expect(JSON.stringify(vi.mocked(f.a.send).mock.calls)).not.toContain('secret')
    expect(f.host.status(f.session, f.a).call?.state).toBe('stopping')
    expect(() => f.host.start(f.session, f.b, 'two', offer)).toThrow(/Another voice/)
    f.raw.stopRealtimeVoice.mockResolvedValue(undefined); await f.host.stop(f.session, f.a, 'one')
  })
})
