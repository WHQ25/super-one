/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceEnvironmentAction } from '@superone/shared/device-environment'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

import { DeviceHingeControl } from './DeviceHingeControl'

function show(hingeDegrees: number, fail = false) {
  const configure = vi.fn(async (deviceId: string, action: DeviceEnvironmentAction) => {
    if (fail) throw new Error('The guest refused the fold.')
    return { status: 'verified' as const, deviceId, action, state: {} as never }
  })
  const preview = vi.fn()
  render(<DeviceHingeControl deviceId="ios-sim:duo" fold={{ hingeDegrees, tent: hingeDegrees > 0 && hingeDegrees <= 60 }}
    disabled={false} onPreview={preview} configure={configure} />)
  return { configure, preview }
}

async function openSlider() {
  await userEvent.click(screen.getByRole('button', { name: 'Hinge Angle' }))
  return screen.findByRole('slider', { name: 'Hinge Angle' })
}

describe('device hinge control', () => {
  it('names the form the angle picks: 0 fold, up to 60 tent, wider unfold', async () => {
    const { configure } = show(120)
    const slider = await openSlider()
    expect(screen.getByText('Unfold · 120°')).toBeInTheDocument()

    for (const [value, form] of [['60', 'Tent'], ['1', 'Tent'], ['0', 'Fold'], ['61', 'Unfold']] as const) {
      fireEvent.change(slider, { target: { value } })
      expect(screen.getByText(`${form} · ${value}°`)).toBeInTheDocument()
    }
    expect(configure).not.toHaveBeenCalled()
  })

  it('lets the 3D body follow a drag within its form, which the device takes once, on release', async () => {
    const { configure, preview } = show(90)
    const slider = await openSlider()
    preview.mockClear()

    // Past 60 the drag leaves the open form; the body stops at its edge.
    for (const value of ['70', '61', '50', '40']) fireEvent.change(slider, { target: { value } })
    expect(preview.mock.calls.map(([degrees]) => degrees)).toEqual([70, 61, 61, 61])
    expect(screen.getByText('Tent · 40°')).toBeInTheDocument()
    expect(configure).not.toHaveBeenCalled()

    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 40 }))
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(null))
    expect(configure).toHaveBeenCalledTimes(1)
  })

  it('jumps to a key angle from its mark', async () => {
    const { configure } = show(0)
    await openSlider()
    await userEvent.click(screen.getByRole('button', { name: 'Tent 60°' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 60 }))
  })

  it('reports a refused move', async () => {
    show(0, true)
    const slider = await openSlider()
    fireEvent.change(slider, { target: { value: '180' } })
    fireEvent.pointerUp(slider)
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('The guest refused the fold.', expect.anything()))
  })
})
