/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceEnvironmentAction } from '@superone/shared/device-environment'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

import { iosSimulatorFoldAt } from '@superone/shared/ios-simulator'
import { DeviceHingeControl, HINGE_DWELL_MS } from './DeviceHingeControl'

function show(hingeDegrees: number, fail = false) {
  const configure = vi.fn(async (deviceId: string, action: DeviceEnvironmentAction) => {
    if (fail) throw new Error('The guest refused the fold.')
    return { status: 'verified' as const, deviceId, action, state: {} as never }
  })
  const preview = vi.fn()
  const formPreview = vi.fn()
  render(<DeviceHingeControl deviceId="ios-sim:duo" fold={iosSimulatorFoldAt(hingeDegrees)!}
    disabled={false} onPreview={preview} onFormPreview={formPreview} configure={configure} />)
  return { configure, preview, formPreview }
}

async function openSlider() {
  await userEvent.click(screen.getByRole('button', { name: 'Hinge Angle' }))
  return screen.findByRole('slider', { name: 'Hinge Angle' })
}

afterEach(() => { vi.useRealTimers() })

describe('device hinge control', () => {
  it('names the form the angle picks: 0 fold, up to 60 tent, 90-120 laptop, else unfold', async () => {
    const { configure } = show(150)
    const slider = await openSlider()
    expect(screen.getByText('Unfold · 150°')).toBeInTheDocument()

    for (const [value, form] of [
      ['60', 'Tent'], ['5', 'Tent'], ['0', 'Fold'], ['61', 'Unfold'], ['80', 'Unfold'],
      ['100', 'Laptop'], ['120', 'Laptop'], ['121', 'Unfold'],
    ] as const) {
      fireEvent.change(slider, { target: { value } })
      expect(screen.getByText(`${form} · ${value}°`)).toBeInTheDocument()
    }
    expect(configure).not.toHaveBeenCalled()
  })

  it('lets the 3D body follow the whole drag, which the device takes once, on release', async () => {
    const { configure, preview, formPreview } = show(150)
    const slider = await openSlider()
    preview.mockClear()
    formPreview.mockClear()

    // Across forms too: the body's hinge runs ahead of the guest the whole way, but it
    // takes no form a drag only passes through.
    for (const value of ['100', '50', '130']) fireEvent.change(slider, { target: { value } })
    expect(preview.mock.calls.map(([degrees]) => degrees)).toEqual([100, 50, 130])
    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()

    // Let go within the form the device is in, the device moves there.
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 130 }))
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(null))
    expect(configure).toHaveBeenCalledTimes(1)
  })

  it('bends only the 3D body for a drag let go in another form, away from its stop', async () => {
    const { configure, preview, formPreview } = show(180)
    const slider = await openSlider()
    formPreview.mockClear()

    fireEvent.change(slider, { target: { value: '100' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    await act(async () => {})

    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()
    expect(preview).toHaveBeenLastCalledWith(100)
  })

  it('takes a stop\'s form when its label is pressed, or a drag is let go on it', async () => {
    const { configure, formPreview } = show(180)
    await openSlider()

    await userEvent.click(screen.getByRole('button', { name: 'Tent 45°' }))
    expect(formPreview).toHaveBeenCalledWith(45)
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 45 }))

    fireEvent.change(screen.getByRole('slider', { name: 'Hinge Angle' }), { target: { value: '92' } })
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Hinge Angle' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 }))
  })

  it('snaps a drag near a stop onto it', async () => {
    const { preview } = show(180)
    const slider = await openSlider()

    fireEvent.change(slider, { target: { value: '93' } })
    expect(preview).toHaveBeenLastCalledWith(90)
    expect(screen.getByText('Laptop · 90°')).toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '94' } })
    expect(preview).toHaveBeenLastCalledWith(94)
  })

  it('takes the form a drag rests on for a moment, without waiting for release', async () => {
    const { configure, formPreview } = show(180)
    const slider = await openSlider()
    formPreview.mockClear()
    vi.useFakeTimers()

    // Passing a stop does not take it.
    fireEvent.change(slider, { target: { value: '90' } })
    act(() => { vi.advanceTimersByTime(HINGE_DWELL_MS - 100) })
    fireEvent.change(slider, { target: { value: '60' } })
    act(() => { vi.advanceTimersByTime(HINGE_DWELL_MS) })
    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()

    fireEvent.change(slider, { target: { value: '46' } })
    act(() => { vi.advanceTimersByTime(HINGE_DWELL_MS) })
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 45 })
    expect(formPreview).toHaveBeenLastCalledWith(45)
    // Still held, still draggable.
    expect(slider).not.toBeDisabled()
    expect(screen.getByText('Tent · 45°')).toBeInTheDocument()
  })

  it('moves the guest one target at a time, the latest one next', async () => {
    let finish!: () => void
    const configure = vi.fn((deviceId: string, action: DeviceEnvironmentAction) =>
      new Promise<never>((resolve) => { finish = () => resolve({ status: 'verified', deviceId, action, state: {} } as never) }))
    render(<DeviceHingeControl deviceId="ios-sim:duo" fold={iosSimulatorFoldAt(0)!}
      disabled={false} onPreview={vi.fn()} onFormPreview={vi.fn()} configure={configure} />)
    const slider = await openSlider()

    for (const value of ['45', '180']) {
      fireEvent.change(slider, { target: { value } })
      fireEvent.pointerUp(slider)
    }
    fireEvent.change(slider, { target: { value: '90' } })
    fireEvent.pointerUp(slider)
    expect(configure).toHaveBeenCalledTimes(1)

    await act(async () => { finish() })
    await waitFor(() => expect(configure).toHaveBeenCalledTimes(2))
    expect(configure).toHaveBeenLastCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 })
  })

  it('jumps to a key angle from its mark', async () => {
    const { configure } = show(0)
    await openSlider()
    await userEvent.click(screen.getByRole('button', { name: 'Tent 45°' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 45 }))
  })

  it('jumps to the laptop from its mark', async () => {
    const { configure } = show(0)
    await openSlider()
    await userEvent.click(screen.getByRole('button', { name: 'Laptop 90°' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 }))
  })

  it('reports a refused move', async () => {
    show(0, true)
    const slider = await openSlider()
    fireEvent.change(slider, { target: { value: '180' } })
    fireEvent.pointerUp(slider)
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('The guest refused the fold.', expect.anything()))
  })
})
