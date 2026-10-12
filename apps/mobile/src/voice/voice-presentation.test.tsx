import { expect, it, jest } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { VoiceAudioLevelStore } from './voice-audio-levels'
import { afterVoiceUiPaint, voicePresentation } from './voice-presentation'
import type { useMobileVoice } from './use-mobile-voice'
import type { MobileVoiceState } from './voice-service'
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const target = { sessionId: 'voice-task', projectPath: '/repo' }
const state: MobileVoiceState = { phase: 'active', target, inputMuted: false, paused: false, pauseReason: null, resuming: false, error: null }
const levels = new VoiceAudioLevelStore()
it('waits for a painted stopping frame and falls back if frame callbacks pause', async () => {
  jest.useFakeTimers()
  const frames: FrameRequestCallback[] = []
  const raf = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
  try {
    const cleanup = jest.fn()
    afterVoiceUiPaint(cleanup)
    frames.shift()!(0)
    expect(cleanup).not.toHaveBeenCalled()
    frames.shift()!(16)
    expect(cleanup).toHaveBeenCalledTimes(1)
    const fallback = jest.fn()
    afterVoiceUiPaint(fallback)
    await jest.advanceTimersByTimeAsync(100)
    expect(fallback).toHaveBeenCalledTimes(1)
    frames.shift()!(200); frames.shift()!(216)
    expect(fallback).toHaveBeenCalledTimes(1)
  } finally { raf.mockRestore(); jest.useRealTimers() }
})
function fixture() {
  const voice = { state, service: { audioLevels: levels, stop: jest.fn(), muteInput: jest.fn(), togglePlayback: jest.fn(async () => {}) },
    supported: true, capability: { supported: true }, retry: jest.fn() } as unknown as ReturnType<typeof useMobileVoice>
  const onReturn = jest.fn(); const onStart = jest.fn()
  return { voice, connected: true, routed: false, sessionId: target.sessionId, projectPath: '/repo',
    view: 'thread' as const, onReturn, onStart, onSettings: jest.fn() }
}
it.each(['same', 'different', 'unsupported', 'other-project'] as const)('returns from the %s text composer without a second voice row', async kind => {
  const f = fixture()
  if (kind === 'different' || kind === 'unsupported') f.sessionId = 'another'
  if (kind === 'unsupported') { f.voice.capability = undefined; f.voice.supported = false }
  if (kind === 'other-project') f.projectPath = '/other'
  const ui = voicePresentation(f)
  expect(ui.composer).toBeUndefined()
  const result = await renderWithTheme(<>{ui.entry}{ui.composer}</>, 'dark', 'zh')
  const entry = result.getByLabelText('返回语音会话')
  expect(entry).toBeEnabled()
  expect(result.queryByTestId('mobile-voice-controls')).toBeNull()
  expect(result.getByTestId('mobile-voice-waveform')).toHaveStyle({ width: 32, height: 32, borderRadius: 16 })
  await act(async () => { fireEvent.press(entry) })
  expect(f.onReturn).toHaveBeenCalledWith(target)
  expect(f.onStart).not.toHaveBeenCalled()
})
it('uses full controls only in the owning voice view and restores start after hangup', async () => {
  const f = fixture()
  const active = voicePresentation({ ...f, view: 'realtime' })
  const result = await renderWithTheme(<>{active.composer}</>)
  expect(result.getByTestId('mobile-voice-controls')).toBeTruthy()
  expect(result.queryByTestId('mobile-voice-return')).toBeNull()
  f.voice.state = { ...state, phase: 'idle', target: null }
  const idle = voicePresentation(f)
  await result.rerender(<>{idle.entry}{idle.composer}</>)
  expect(result.queryByTestId('mobile-voice-controls')).toBeNull()
  await act(async () => { fireEvent.press(result.getByLabelText('Start voice')) })
  expect(f.onStart).toHaveBeenCalledTimes(1)
})
it.each(['streaming', 'offline', 'native-unavailable', 'unsupported', 'starting'] as const)('hides an unavailable %s start and restores it when available', async kind => {
  const f = fixture()
  f.voice.state = { ...state, phase: 'idle', target: null }
  const input = { ...f, streaming: kind === 'streaming', connected: kind !== 'offline' }
  if (kind === 'native-unavailable') f.voice.supported = false
  if (kind === 'unsupported') f.voice.capability = undefined
  if (kind === 'starting') f.voice.state = { ...f.voice.state, phase: 'starting' }
  const blocked = voicePresentation(input)
  expect(blocked.entry).toBeUndefined()
  const result = await renderWithTheme(<>{blocked.entry}</>)
  expect(result.queryAllByRole('button')).toHaveLength(0)
  expect(f.onStart).not.toHaveBeenCalled()
  const ready = fixture()
  ready.voice.state = { ...state, phase: 'idle', target: null }
  await result.rerender(<>{voicePresentation(ready).entry}</>)
  await act(async () => { fireEvent.press(result.getByLabelText('Start voice')) })
  expect(ready.onStart).toHaveBeenCalledTimes(1)
})
it('hides a new start while the backing task runs but keeps an existing paused call reachable', async () => {
  const f = fixture()
  f.voice.state = { ...state, phase: 'idle', target: null }
  const blocked = voicePresentation({ ...f, streaming: true })
  const result = await renderWithTheme(<>{blocked.entry}</>, 'light', 'zh')
  expect(blocked.entry).toBeUndefined()
  expect(result.queryAllByRole('button')).toHaveLength(0)
  expect(f.onStart).not.toHaveBeenCalled()
  f.voice.state = { ...state, paused: true, pauseReason: 'interrupted' }
  const live = voicePresentation({ ...f, streaming: true })
  await result.rerender(<>{live.entry}</>)
  expect(result.getByLabelText('返回语音会话')).toBeEnabled()
})
