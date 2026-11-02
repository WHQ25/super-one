/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceEnvironmentAction } from '@superone/shared/device-environment'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

import { iosSimulatorFoldAt } from '@superone/shared/ios-simulator'
import { DeviceHingeControl, HINGE_DWELL_MS } from './DeviceHingeControl'
import { HINGE_CLICK_DEGREES_PER_SECOND } from './device-hinge-motion'

function show(hingeDegrees: number, fail = false) {
  const configure = vi.fn(async (deviceId: string, action: DeviceEnvironmentAction) => {
    if (fail) throw new Error('The guest refused the fold.')
    return { status: 'verified' as const, deviceId, action, state: {} as never }
  })
  const preview = vi.fn()
  const formPreview = vi.fn()
  const scrubbing = vi.fn()
  render(<DeviceHingeControl deviceId="ios-sim:duo" fold={iosSimulatorFoldAt(hingeDegrees)!}
    disabled={false} onPreview={preview} onFormPreview={formPreview} onScrubbing={scrubbing} configure={configure} />)
  return { configure, preview, formPreview, scrubbing }
}

async function openSlider() {
  await userEvent.click(screen.getByRole('button', { name: 'Hinge Angle' }))
  return screen.findByRole('slider', { name: 'Hinge Angle' })
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

/** Run the click's animation. One frame past the end settles the last step. */
async function travel(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms + 20) })
}

const clickMs = (degrees: number) => (degrees / HINGE_CLICK_DEGREES_PER_SECOND) * 1000

describe('device hinge control', () => {
  it('names the form the angle picks: 0-30 fold, 31-60 tent, 61-80 and 121-180 unfold, 81-120 laptop', async () => {
    const { configure } = show(150)
    const slider = await openSlider()
    expect(screen.getByText('Unfold · 150°')).toBeInTheDocument()

    for (const [value, form] of [
      ['30', 'Fold'], ['31', 'Tent'], ['60', 'Tent'], ['61', 'Unfold'], ['80', 'Unfold'],
      ['81', 'Laptop'], ['120', 'Laptop'], ['121', 'Unfold'],
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

  it('opens the book when a drag from fold is let go past the laptop', async () => {
    const { configure, formPreview } = show(0)
    const slider = await openSlider()

    fireEvent.change(slider, { target: { value: '150' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)

    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 150 }))
    expect(formPreview).toHaveBeenCalledWith(150)
  })

  it('opens the book when a laptop is let go past its range', async () => {
    const { configure, formPreview } = show(100)
    const slider = await openSlider()
    formPreview.mockClear()

    fireEvent.change(slider, { target: { value: '121' } })
    fireEvent.pointerUp(slider)

    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 121 }))
    expect(formPreview).toHaveBeenCalledWith(121)
  })

  it('opens the book when a drag from fold is let go between the tent and the laptop', async () => {
    const { configure, formPreview } = show(0)
    const slider = await openSlider()

    fireEvent.change(slider, { target: { value: '70' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)

    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 70 }))
    expect(formPreview).toHaveBeenCalledWith(70)
  })

  it('bends only the 3D body for a drag let go in a tent, off its stop', async () => {
    const { configure, preview, formPreview } = show(0)
    const slider = await openSlider()
    formPreview.mockClear()

    // 50° is a tent and not the 45° stop: letting go there from fold still only bends the body.
    fireEvent.change(slider, { target: { value: '50' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    await act(async () => {})

    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()
    expect(preview).toHaveBeenLastCalledWith(50)
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
    const { configure, formPreview, scrubbing } = show(180)
    await openSlider()
    formPreview.mockClear()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Tent 45°' }))
    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()
    expect(scrubbing).toHaveBeenLastCalledWith(true)
    expect(screen.getByText('Unfold · 180°')).toBeInTheDocument()

    // 135° at the click rate. The form is taken when the travel arrives, as a drag let go there.
    await travel(clickMs(180 - 45))
    expect(formPreview).toHaveBeenCalledWith(45)
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 45 })
    expect(scrubbing).toHaveBeenLastCalledWith(false)

    vi.useRealTimers()
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

  it('scrubs for the whole drag, including a rest that already sends the guest', async () => {
    const { configure, scrubbing } = show(180)
    const slider = await openSlider()
    vi.useFakeTimers()

    fireEvent.change(slider, { target: { value: '46' } })
    expect(scrubbing).toHaveBeenCalledTimes(1)
    expect(scrubbing).toHaveBeenLastCalledWith(true)
    fireEvent.change(slider, { target: { value: '44' } })
    expect(scrubbing).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(HINGE_DWELL_MS) })
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 45 })
    expect(scrubbing).toHaveBeenLastCalledWith(true)

    fireEvent.pointerUp(slider)
    expect(scrubbing).toHaveBeenLastCalledWith(false)
    await act(async () => {})
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

  it('travels to a clicked mark at a fixed rate and skips the stops it only passes', async () => {
    const { configure, formPreview, preview } = show(0)
    await openSlider()
    formPreview.mockClear()
    preview.mockClear()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Laptop 90°' }))
    expect(configure).not.toHaveBeenCalled()
    expect(preview).toHaveBeenLastCalledWith(0)

    // Halfway is the tent. A 90° trip is shorter than a rest, so this only checks the rate.
    await travel(clickMs(45))
    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()
    const halfway = preview.mock.calls.at(-1)?.[0]
    expect(halfway).toBeGreaterThan(40)
    expect(halfway).toBeLessThan(55)

    await travel(clickMs(45))
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 })
  })

  it('keeps the same rate out to flat, instead of speeding a wide click up', async () => {
    const { configure, formPreview, preview } = show(0)
    await openSlider()
    formPreview.mockClear()
    preview.mockClear()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Unfold 180°' }))
    await travel(clickMs(45))
    expect(configure).not.toHaveBeenCalled()
    expect(preview.mock.calls.at(-1)?.[0]).toBeGreaterThan(40)
    expect(preview.mock.calls.at(-1)?.[0]).toBeLessThan(55)

    // Past the tent by longer than a rest, and still short of flat. At 180°/s the
    // laptop stop sits half a second before the end, so a rest there would meet arrival.
    const elapsed = clickMs(45) + 20
    const pastTent = clickMs(45) + HINGE_DWELL_MS + 40
    await act(async () => { await vi.advanceTimersByTimeAsync(pastTent - elapsed) })
    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()

    await travel(clickMs(180) - pastTent)
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 180 })
  })

  it('retargets a second click from the angle already reached', async () => {
    const { configure, preview } = show(0)
    await openSlider()
    preview.mockClear()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Unfold 180°' }))
    await travel(clickMs(45))
    fireEvent.click(screen.getByRole('button', { name: 'Laptop 90°' }))
    expect(configure).not.toHaveBeenCalled()

    await travel(clickMs(90 - 45))
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 })
    expect(preview.mock.calls.some(([degrees]) => degrees === 180)).toBe(false)
  })

  it('drops a travelling click when the pointer drags', async () => {
    const { configure, preview, scrubbing } = show(0)
    await openSlider()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Unfold 180°' }))
    await travel(500)
    fireEvent.change(screen.getByRole('slider', { name: 'Hinge Angle' }), { target: { value: '20' } })
    expect(preview).toHaveBeenLastCalledWith(20)
    expect(scrubbing).toHaveBeenLastCalledWith(true)

    await travel(5000)
    expect(configure).not.toHaveBeenCalled()
    expect(preview).toHaveBeenLastCalledWith(20)
  })

  it('travels when the track is clicked and follows once the pointer moves', async () => {
    const { configure, preview, scrubbing } = show(0)
    const slider = await openSlider()
    preview.mockClear()
    vi.useFakeTimers()

    fireEvent.pointerDown(slider, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.change(slider, { target: { value: '90' } })
    expect(preview).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { clientX: 2, clientY: 0, pointerId: 1 })
    expect(scrubbing).toHaveBeenLastCalledWith(true)
    expect(configure).not.toHaveBeenCalled()

    await travel(clickMs(90))
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 })
    await act(async () => {})

    vi.useRealTimers()
    preview.mockClear()
    configure.mockClear()
    fireEvent.pointerDown(slider, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.change(slider, { target: { value: '80' } })
    fireEvent.pointerMove(slider, { clientX: 8, clientY: 0, pointerId: 1 })
    expect(preview).toHaveBeenLastCalledWith(80)
    fireEvent.change(slider, { target: { value: '180' } })
    expect(preview).toHaveBeenLastCalledWith(180)
    fireEvent.pointerUp(slider, { clientX: 8, clientY: 1, pointerId: 1 })
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 180 })
    await act(async () => {})
  })

  it('lands a click inside a form as that form, and a drag let go there only bends', async () => {
    const { configure, formPreview } = show(0)
    const slider = await openSlider()
    formPreview.mockClear()
    vi.useFakeTimers()

    fireEvent.pointerDown(slider, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.change(slider, { target: { value: '55' } })
    fireEvent.pointerUp(slider, { clientX: 1, clientY: 0, pointerId: 1 })
    await travel(clickMs(30))
    expect(configure).not.toHaveBeenCalled()
    expect(formPreview).not.toHaveBeenCalled()

    await travel(clickMs(25))
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 55 })
    expect(formPreview).toHaveBeenCalledWith(55)
    expect(formPreview).not.toHaveBeenCalledWith(45)

    // A drag let go at the same angle, from another form, still only bends.
    fireEvent.change(slider, { target: { value: '55' } })
    fireEvent.pointerUp(slider)
    expect(configure).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(slider, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.change(slider, { target: { value: '110' } })
    fireEvent.pointerUp(slider, { clientX: 0, clientY: 1, pointerId: 1 })
    await travel(clickMs(110))
    expect(configure).toHaveBeenLastCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 110 })
    expect(formPreview).toHaveBeenCalledWith(110)
    await act(async () => {})
  })

  it('jumps a click when motion is reduced', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    const { configure, preview } = show(0)
    await openSlider()
    preview.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Laptop 90°' }))
    expect(preview).toHaveBeenCalledWith(90)
    expect(configure).toHaveBeenCalledWith('ios-sim:duo', { kind: 'hinge', degrees: 90 })
    await act(async () => {})
  })

  it('reports a refused move', async () => {
    show(0, true)
    const slider = await openSlider()
    fireEvent.change(slider, { target: { value: '180' } })
    fireEvent.pointerUp(slider)
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('The guest refused the fold.', expect.anything()))
  })
})
