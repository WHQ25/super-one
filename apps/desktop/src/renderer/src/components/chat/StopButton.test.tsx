/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StopButton } from './StopButton'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('Stop feedback', () => {
  it('animates throughout a delayed request and ignores duplicate activation', async () => {
    let finish!: () => void
    const interrupt = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    render(<StopButton onInterrupt={interrupt} />)
    fireEvent.click(screen.getByRole('button'))
    const button = screen.getByRole('button', { name: 'chat.stoppingGeneration' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(interrupt).toHaveBeenCalledTimes(1))
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(interrupt).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    expect(screen.getByRole('button', { name: 'chat.stopGeneration' })).not.toHaveAttribute('aria-busy')
  })

  it('makes Stop available again after a rejected request', async () => {
    const interrupt = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    render(<StopButton onInterrupt={interrupt} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy'))
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(interrupt).toHaveBeenCalledTimes(2))
  })

  it('holds Escape to stop once and keeps the ring until the request settles', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const interrupt = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    try {
      render(<StopButton onInterrupt={interrupt} />)
      fireEvent.keyDown(window, { key: 'Escape' })
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      expect(interrupt).toHaveBeenCalledTimes(1)
      fireEvent.keyUp(window, { key: 'Escape' })
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
      await act(async () => { finish() })
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
    } finally { vi.useRealTimers() }
  })

  it('retains pending feedback when a composer mounts during cancellation', () => {
    const interrupt = vi.fn()
    render(<StopButton onInterrupt={interrupt} stopping />)
    const button = screen.getByRole('button', { name: 'chat.stoppingGeneration' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(interrupt).not.toHaveBeenCalled()
  })
})
