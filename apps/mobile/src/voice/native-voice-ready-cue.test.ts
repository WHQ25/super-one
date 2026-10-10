import { afterEach, expect, it, vi } from 'vitest'
import { VOICE_READY_CUE_DURATION_MS, VOICE_READY_CUE_MIC_GUARD_MS } from '@superone/shared/voice-ready-cue'
import { playNativeVoiceReadyCue } from './native-voice-ready-cue'
afterEach(() => vi.useRealTimers())

it('plays the bundled desktop cue once, guards its onset, and stops before repetition', async () => {
  vi.useFakeTimers()
  const player = { startRingback: vi.fn(), stopRingback: vi.fn() }; const guard = vi.fn()
  const close = playNativeVoiceReadyCue(player, guard)
  expect(guard).toHaveBeenLastCalledWith(true)
  expect(player.startRingback).toHaveBeenCalledWith('_BUNDLE_')
  await vi.advanceTimersByTimeAsync(VOICE_READY_CUE_MIC_GUARD_MS)
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(player.stopRingback).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(VOICE_READY_CUE_DURATION_MS)
  expect(player.stopRingback).toHaveBeenCalledTimes(1)
  close(); expect(player.stopRingback).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('cancels playback and guard timers on hangup and tolerates native cue failures', async () => {
  vi.useFakeTimers()
  const player = { startRingback: vi.fn(), stopRingback: vi.fn() }; const guard = vi.fn()
  playNativeVoiceReadyCue(player, guard)()
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(vi.getTimerCount()).toBe(0)
  player.startRingback.mockImplementation(() => { throw new Error('unavailable') })
  player.stopRingback.mockImplementation(() => { throw new Error('already stopped') })
  expect(() => playNativeVoiceReadyCue(player, guard)).not.toThrow()
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(vi.getTimerCount()).toBe(0)
})
