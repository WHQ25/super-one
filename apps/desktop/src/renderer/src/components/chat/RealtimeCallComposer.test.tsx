/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { RealtimeCallComposer } from './RealtimeCallComposer'

vi.mock('./SessionDecisionPrompts', () => ({ SessionDecisionPrompts: () => <div data-testid="decision-prompts" /> }))
vi.mock('./RealtimeCallIndicator', () => ({ RealtimeCallIndicator: () => <div data-testid="realtime-call-indicator" /> }))
vi.mock('./RealtimeCallControls', () => ({
  RealtimeCallControls: ({ disabled }: { disabled?: boolean }) => <div data-testid="call-controls" data-disabled={String(!!disabled)} />,
}))

afterEach(() => {
  cleanup()
  resetRealtimeCallForTests()
})

describe('RealtimeCallComposer', () => {
  it('shows the mark with a connecting line, and no controls, while the offer is out', () => {
    useRealtimeCallStore.setState({ sessionId: 'sid', state: 'starting' })
    render(<RealtimeCallComposer />)
    expect(screen.getByTestId('decision-prompts')).toBeInTheDocument()
    const composer = screen.getByTestId('realtime-call-composer')
    expect(composer).toHaveAttribute('data-call-state', 'starting')
    expect(composer.contains(screen.getByTestId('realtime-call-indicator'))).toBe(true)
    expect(screen.getByText('Connecting voice…')).toBeInTheDocument()
    expect(screen.queryByTestId('call-controls')).toBeNull()
  })

  it('shows the mark with its controls, then the hanging-up line in their place', () => {
    useRealtimeCallStore.setState({ sessionId: 'sid', state: 'active' })
    render(<RealtimeCallComposer />)
    const composer = screen.getByTestId('realtime-call-composer')
    expect(composer.contains(screen.getByTestId('realtime-call-indicator'))).toBe(true)
    expect(screen.getByTestId('call-controls')).toHaveAttribute('data-disabled', 'false')

    // Hanging up swaps the controls for the status line in the same fixed-height foot.
    act(() => useRealtimeCallStore.setState({ state: 'stopping' }))
    expect(screen.getByText('Ending voice conversation…')).toBeInTheDocument()
    expect(screen.queryByTestId('call-controls')).toBeNull()
  })

  it('keeps the last engaged state on screen after the store goes idle, so the exit animation has something to move', () => {
    useRealtimeCallStore.setState({ sessionId: 'sid', state: 'active' })
    render(<RealtimeCallComposer />)
    act(() => resetRealtimeCallForTests())
    const composer = screen.getByTestId('realtime-call-composer')
    expect(composer).toHaveAttribute('data-call-state', 'active')
    expect(composer.contains(screen.getByTestId('realtime-call-indicator'))).toBe(true)
    expect(screen.getByText('Ending voice conversation…')).toBeInTheDocument()
  })
})
