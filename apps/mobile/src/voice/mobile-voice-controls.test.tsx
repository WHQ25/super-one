import { expect, it, jest } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { MobileVoiceControls } from './mobile-voice-controls'
import type { MobileVoiceState } from './voice-service'
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

it('keeps microphone, waveform, play and end in that order', async () => {
  const state: MobileVoiceState = { phase: 'active', target: { sessionId: 'sid', projectPath: '/p', title: 'Voice task' }, inputMuted: true, paused: true, pauseReason: 'manual', resuming: false, error: null }
  const stop = jest.fn(); const input = jest.fn()
  const result = await renderWithTheme(<MobileVoiceControls state={state} onStop={stop} onInputMute={input} onPlayback={() => {}} onRetry={() => {}} onSettings={() => {}} />)
  expect(result.queryByLabelText('Speakerphone')).toBeNull()
  expect(result.queryByText('↗')).toBeNull()
  expect(result.queryByLabelText('Unmute voice output')).toBeNull()
  expect(result.queryByLabelText('Mute voice output')).toBeNull()
  expect(result.getAllByRole('button').map(button => button.props.accessibilityLabel)).toEqual(['Unmute microphone', 'Resume voice', 'End voice'])
  const row = result.getByTestId('mobile-voice-controls')
  expect(row.children[0]).toBe(result.getByLabelText('Unmute microphone'))
  expect(row.children[1]).toBe(result.getByTestId('mobile-voice-status'))
  expect(row.children[2]).toBe(result.getByLabelText('Resume voice'))
  await act(async () => { fireEvent.press(result.getByLabelText('Unmute microphone')) })
  await act(async () => { fireEvent.press(result.getByLabelText('End voice')) })
  expect(input).toHaveBeenCalledTimes(1)
  expect(stop).toHaveBeenCalledTimes(1)
})

it('keeps the framed composer in one row and renders permission errors in Chinese', async () => {
  const state: MobileVoiceState = { phase: 'denied', target: { sessionId: 'sid', projectPath: '/p' }, inputMuted: false, paused: false, pauseReason: null, resuming: false, error: 'Microphone access denied. Enable it in Settings.' }
  const noop = () => {}; const settings = jest.fn()
  const result = await renderWithTheme(<MobileVoiceControls state={state} onStop={noop} onInputMute={noop} onPlayback={noop} onRetry={noop} onSettings={settings} />, 'dark', 'zh')
  expect(result.getByText('麦克风权限被拒绝，请在设置中开启。')).toBeTruthy()
  expect(result.getByTestId('mobile-voice-controls')).toHaveStyle({ flexDirection: 'row', minHeight: 52, borderWidth: 1, borderRadius: 20 })
  expect(result.queryByTestId('mobile-voice-waveform')).toBeNull()
  expect(result.getByLabelText('打开设置')).toBeTruthy()
  expect(result.getAllByRole('button').map(button => button.props.accessibilityLabel)).toEqual(['打开设置', '暂停语音', '结束语音'])
  await act(async () => { fireEvent.press(result.getByLabelText('打开设置')) })
  expect(settings).toHaveBeenCalledTimes(1)
})

it('enables the left microphone only after connecting and disables controls during hangup', async () => {
  const state: MobileVoiceState = { phase: 'starting', target: { sessionId: 'sid', projectPath: '/p' }, inputMuted: false, paused: false, pauseReason: null, resuming: false, error: null }
  const input = jest.fn(); const stop = jest.fn(); const noop = () => {}
  const controls = (phase: MobileVoiceState['phase']) => <MobileVoiceControls state={{ ...state, phase }} onStop={stop} onInputMute={input} onPlayback={() => {}} onRetry={noop} onSettings={noop} />
  const result = await renderWithTheme(controls('starting'))
  expect(result.getByText('Starting voice session…')).toBeTruthy()
  expect(result.queryByTestId('mobile-voice-indicator')).toBeNull()
  expect(result.queryByTestId('mobile-voice-waveform')).toBeNull()
  expect(result.getByLabelText('Mute microphone')).toBeDisabled()
  expect(result.getByLabelText('Cancel voice')).toBeEnabled()
  await act(async () => { fireEvent.press(result.getByLabelText('Mute microphone')) })
  expect(input).not.toHaveBeenCalled()
  await result.rerender(controls('active'))
  expect(result.queryByText('Listening')).toBeNull()
  expect(result.getByTestId('mobile-voice-waveform')).toHaveStyle({ flex: 1, height: 36 })
  expect(result.getByLabelText('Mute microphone')).toBeEnabled()
  await act(async () => { fireEvent.press(result.getByLabelText('Mute microphone')) })
  expect(input).toHaveBeenCalledTimes(1)
  await result.rerender(controls('stopping'))
  expect(result.getByText('Hanging up')).toBeTruthy()
  expect(result.getByLabelText('Mute microphone')).toBeDisabled()
  expect(result.getByLabelText('Cancel voice')).toBeDisabled()
  await act(async () => { fireEvent.press(result.getByLabelText('Cancel voice')) })
  expect(stop).not.toHaveBeenCalled()
})
