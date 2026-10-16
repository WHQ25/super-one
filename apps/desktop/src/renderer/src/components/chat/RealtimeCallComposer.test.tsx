/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { RealtimeCallComposer } from './RealtimeCallComposer'

afterEach(() => { cleanup(); resetRealtimeCallForTests() })

it('keeps cancellation available during negotiation, disabling mute and playback', () => {
  useRealtimeCallStore.setState({ sessionId: 'sid', state: 'starting' })
  render(<RealtimeCallComposer />)
  expect(screen.getByText('Starting voice session…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Pause Voice' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Stop Voice Conversation' })).toBeEnabled()
})

it('retains the bar and disables every action while hanging up and leaving the slot', () => {
  useRealtimeCallStore.setState({ sessionId: 'sid', state: 'active' })
  render(<RealtimeCallComposer />)
  expect(screen.getByTestId('voice-waveform')).toBeInTheDocument()
  act(() => useRealtimeCallStore.setState({ state: 'stopping' }))
  expect(screen.getByText('Hanging up')).toBeInTheDocument()
  for (const button of within(screen.getByTestId('realtime-call-composer')).getAllByRole('button')) expect(button).toBeDisabled()
  act(() => resetRealtimeCallForTests())
  expect(screen.getByTestId('realtime-call-composer')).toHaveAttribute('data-call-state', 'stopping')
  expect(screen.getByText('Hanging up')).toBeInTheDocument()
})

it('shows a resume hint after audio interruption and prevents duplicate resume requests', () => {
  useRealtimeCallStore.setState({ sessionId: 'sid', state: 'active', paused: true, pauseReason: 'interrupted', resuming: true })
  render(<RealtimeCallComposer />)
  expect(screen.getByRole('status')).toHaveTextContent('Audio interrupted. Tap Play to continue.')
  expect(screen.getByRole('button', { name: 'Resume Voice' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Stop Voice Conversation' })).toBeEnabled()
})
