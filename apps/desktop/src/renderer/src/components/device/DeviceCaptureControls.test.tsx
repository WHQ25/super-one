/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceCapture } from '@superone/shared/device'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

import { DeviceCaptureControls } from './DeviceCaptureControls'

const CLIP: DeviceCapture = {
  kind: 'recording',
  path: '/captures/session-1/iPhone-17-Pro-20260820-164452.mp4',
  fileName: 'iPhone-17-Pro-20260820-164452.mp4',
}

function stubEnvironment(overrides: Record<string, unknown> = {}) {
  const api = {
    deviceScreenshot: vi.fn(async () => ({
      kind: 'screenshot' as const,
      path: '/captures/session-1/shot.png',
      fileName: 'shot.png',
    })),
    deviceRecordStart: vi.fn(async () => CLIP),
    deviceRecordStop: vi.fn(async () => CLIP),
    ...overrides,
  }
  // The setup file installs a get-trap Proxy that ignores its target, so stubs
  // have to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', { configurable: true, value: api })
  return api
}

describe('iOS Simulator capture controls', () => {
  afterEach(() => { vi.useRealTimers() })

  it('saves a screenshot and offers a way to find the file', async () => {
    toasts.success.mockClear()
    const api = stubEnvironment()
    render(<DeviceCaptureControls deviceId="ios-sim:sim-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Screenshot' }))

    expect(api.deviceScreenshot).toHaveBeenCalledWith('ios-sim:sim-1')
    await waitFor(() => expect(toasts.success).toHaveBeenCalled())
    const [message, options] = toasts.success.mock.calls.at(-1)!
    expect(message).toContain('shot.png')
    expect(options.action.label).toBe('Show in Finder')
  })

  it('disables recording without disabling screenshots when the platform cannot record', () => {
    stubEnvironment()
    render(<DeviceCaptureControls deviceId="ios-sim:sim-1" canRecord={false} />)

    expect(screen.getByRole('button', { name: 'Screenshot' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Record Screen' })).toBeDisabled()
  })

  it('flips the record button into a stop button and back', async () => {
    const api = stubEnvironment()
    render(<DeviceCaptureControls deviceId="ios-sim:sim-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Record Screen' }))

    const stop = await screen.findByRole('button', { name: 'Stop Recording' })
    expect(stop).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(stop)

    expect(api.deviceRecordStop).toHaveBeenCalledWith('ios-sim:sim-1')
    await screen.findByRole('button', { name: 'Record Screen' })
  })

  it('stays on the record button when the recording fails to start', async () => {
    toasts.error.mockClear()
    stubEnvironment({
      deviceRecordStart: vi.fn(async () => { throw new Error('Recording failed.') }),
    })
    render(<DeviceCaptureControls deviceId="ios-sim:sim-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Record Screen' }))

    // A start that reported an error but left a stop button behind would strand the
    // panel: there is nothing running for that button to stop.
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Recording failed.', expect.anything()))
    expect(screen.getByRole('button', { name: 'Record Screen' })).toBeInTheDocument()
  })

  it('counts the recording up on a clock while it runs', async () => {
    vi.useFakeTimers()
    stubEnvironment()
    render(<DeviceCaptureControls deviceId="ios-sim:sim-1" />)

    // `fireEvent`, not `userEvent`, and `act`, not `findBy*`/`waitFor`. Both of the
    // ergonomic ones wait on real timers that `useFakeTimers` has frozen, and
    // neither auto-detects vitest's fakes -- Testing Library only sniffs for JEST's.
    fireEvent.click(screen.getByRole('button', { name: 'Record Screen' }))
    await act(async () => {})

    const clock = screen.getByRole('timer', { name: 'Recording…' })
    expect(clock).toHaveTextContent('0:00')

    // Past a minute on purpose: only the seconds are zero-padded, so 1:05 is the
    // case a naive `${minutes}:${seconds}` renders as the wrong "1:5".
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000) })
    expect(clock).toHaveTextContent('1:05')

    fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }))
    await act(async () => {})
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('ends an open recording when the stage goes away', async () => {
    const api = stubEnvironment()
    const view = render(<DeviceCaptureControls deviceId="ios-sim:sim-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Record Screen' }))
    await screen.findByRole('button', { name: 'Stop Recording' })
    view.unmount()

    // Unmounting takes the stop button with it, so an unattended recording would
    // otherwise run until the session detached.
    expect(api.deviceRecordStop).toHaveBeenCalledWith('ios-sim:sim-1')
  })
})
