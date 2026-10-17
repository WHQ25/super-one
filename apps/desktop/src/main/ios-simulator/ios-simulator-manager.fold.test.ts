import { describe, expect, it, vi } from 'vitest'
import type { IosSimulatorSessionState } from '@superone/shared/ios-simulator'
import { IosSimulatorManager } from './ios-simulator-manager'
import { device, setup } from './ios-simulator-manager.fixture'

describe('IosSimulatorManager foldable', () => {
  const open = (hingeDegrees: number) => ({ hingeDegrees, tent: false })

  const DUO = 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'
  const layout = {
    cover: { screenId: 1, panelRotation: 0 as const },
    inner: { screenId: 3, panelRotation: 90 as const },
  }

  function duo(initial = device({ deviceTypeIdentifier: DUO })) {
    const harness = setup(initial)
    harness.simctl.listDeviceTypeBundles.mockResolvedValue(new Map([[DUO, '/duo']]))
    const chrome = { load: vi.fn(async () => null), foldLayout: vi.fn(async () => layout) }
    const manager = new IosSimulatorManager({
      simctl: harness.simctl,
      chrome,
      nativeFactory: harness.nativeFactory,
      capture: harness.capture,
      captureRoot: '/captures',
      helperProbe: async () => null,
      attachAttempts: 1,
    })
    return { ...harness, chrome, manager }
  }

  it('boots closed on the cover without moving a hinge it already knows', async () => {
    const { manager, native } = duo()

    const state = await manager.boot('session-a', 'device-a')

    expect(native.attach).toHaveBeenCalledWith('device-a', 1)
    expect(native.fold).not.toHaveBeenCalled()
    expect(state.fold).toEqual({ hingeDegrees: 0, tent: false, panel: 'cover', panelRotation: 0 })
  })

  it('closes a foldable it finds running, since the hinge cannot be read', async () => {
    const { manager, native } = duo(device({ deviceTypeIdentifier: DUO, state: 'Booted', booted: true }))

    await manager.bind('session-a', 'device-a')

    // An unfolded device left by someone else would show its black cover forever.
    expect(native.fold).toHaveBeenCalledWith(0, expect.any(Number), 1, false)
  })

  it('unfolds onto the inner panel and reopens the stream there', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    const stop = manager.subscribePreview('device-a', () => undefined)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalledTimes(1))
    const published: IosSimulatorSessionState[] = []
    manager.onSessionState((state) => published.push(state))

    await manager.setFoldPosition('device-a', open(180))

    expect(native.fold).toHaveBeenCalledWith(1, expect.any(Number), 3, false)
    expect(native.startFrames).toHaveBeenCalledTimes(2)
    expect(published.at(-1)).toEqual(expect.objectContaining({
      pixelWidth: 2007,
      pixelHeight: 2853,
      fold: { hingeDegrees: 180, tent: false, panel: 'inner', panelRotation: 90 },
    }))
    expect(await manager.foldPosition('device-a')).toEqual(open(180))
    stop()
    await manager.dispose()
  })

  it('moves to any angle between, which the guest already shows on the inner panel', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')

    await manager.setFoldPosition('device-a', open(135))

    expect(native.fold).toHaveBeenCalledWith(0.75, expect.any(Number), 3, false)
    expect(await manager.foldPosition('device-a')).toEqual(open(135))
    // Up to 60 the angle is a tent's, never an inner opening.
    await expect(manager.setFoldPosition('device-a', open(45))).rejects.toThrow(/up to 60/)
    await expect(manager.setFoldPosition('device-a', open(181))).rejects.toThrow(/between 0 and 180/)
  })

  it('keeps the stream through a move within one panel, and sweeps only its share', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    const stop = manager.subscribePreview('device-a', () => undefined)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalledTimes(1))

    await manager.setFoldPosition('device-a', open(180))
    await manager.setFoldPosition('device-a', open(120))

    // Closed to open swaps panels; 180 to 120 stays on the inner one.
    expect(native.startFrames).toHaveBeenCalledTimes(2)
    expect(native.fold).toHaveBeenNthCalledWith(1, 1, 600, 3, false)
    expect(native.fold).toHaveBeenNthCalledWith(2, 120 / 180, 200, 3, false)
    stop()
    await manager.dispose()
  })

  it('stands as a tent on its edge: turned, half open, and the cover lit', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    const stop = manager.subscribePreview('device-a', () => undefined)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalledTimes(1))
    const published: IosSimulatorSessionState[] = []
    manager.onSessionState((state) => published.push(state))

    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true })

    // Turned first, then stood up from closed: the pose rides the fold, after its sweep.
    expect(native.input).toHaveBeenCalledWith({ type: 'rotate', orientation: 'landscape-right' })
    expect(native.fold).toHaveBeenLastCalledWith(0, expect.any(Number), 1, true)
    // The cover was lit before and is lit now, so the stream keeps its display.
    expect(native.startFrames).toHaveBeenCalledTimes(1)
    expect(published.at(-1)).toEqual(expect.objectContaining({
      orientation: 'landscape-right',
      fold: { hingeDegrees: 60, tent: true, panel: 'cover', panelRotation: 0 },
    }))
    stop()
    await manager.dispose()
  })

  it('stands a tent up from closed whatever the hinge was, and opens it wider without the guest', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))
    native.fold.mockClear()

    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true })
    await manager.setFoldPosition('device-a', { hingeDegrees: 30, tent: true })

    // From open the switch to the tent would be a cover swap that never finishes; a
    // tent's angle after that is the host's alone, since the guest pose has none.
    expect(native.fold.mock.calls.map((call) => [call[0], call[1], call[2], call[3]])).toEqual([[0, 600, 1, true]])
    expect(await manager.foldPosition('device-a')).toEqual({ hingeDegrees: 30, tent: true })
    await expect(manager.setFoldPosition('device-a', { hingeDegrees: 90, tent: true })).rejects.toThrow(/up to 60/)
  })

  it('holds each new form its own way, and leaves a turn alone within one', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true })
    native.input.mockClear()

    // Out of the tent: opened is held upright again, its inner panel then landscape.
    await manager.setFoldPosition('device-a', open(180))
    expect(native.input).toHaveBeenCalledWith({ type: 'rotate', orientation: 'portrait' })

    // The user turns it; a wider or narrower opening keeps that turn.
    await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })
    native.input.mockClear()
    await manager.setFoldPosition('device-a', open(120))
    expect(native.input).not.toHaveBeenCalled()

    // A named posture is a form, so it is held its own way even within one: back upright.
    await manager.setFoldPosition('device-a', open(180), { hold: true })
    expect(native.input).toHaveBeenCalledWith({ type: 'rotate', orientation: 'portrait' })
    await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })
    native.input.mockClear()

    // Folding shut is a phone again, upright.
    const states: IosSimulatorSessionState[] = []
    manager.onSessionState((state) => states.push(state))
    await manager.setFoldPosition('device-a', open(0))
    expect(native.input).toHaveBeenCalledWith({ type: 'rotate', orientation: 'portrait' })
    expect(states.at(-1)?.orientation).toBe('portrait')
  })

  it('closes on the way out of a tent, since a sweep alone would leave the cover lit', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true })
    native.fold.mockClear()

    await manager.setFoldPosition('device-a', open(120))

    expect(native.fold.mock.calls.map((call) => [call[0], call[2], call[3]])).toEqual([[0, 1, false], [120 / 180, 3, false]])
    expect(await manager.foldPosition('device-a')).toEqual(open(120))

    native.fold.mockClear()
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true })
    await manager.setFoldPosition('device-a', open(0))
    // Closing from a tent is one sweep: closed already shows the cover.
    expect(native.fold.mock.calls.map((call) => [call[0], call[2], call[3]])).toEqual([[0, 1, true], [0, 1, false]])
  })

  it('loads the chrome of whichever panel the hinge shows', async () => {
    const { manager, chrome } = duo()
    await manager.boot('session-a', 'device-a')

    await manager.chrome('device-a')
    await manager.setFoldPosition('device-a', open(180))
    await manager.chrome('device-a')

    expect(chrome.load.mock.calls.map((call) => (call as unknown[])[3])).toEqual([1, 3])
  })

  it('trusts a rotation on the inner panel, whose turn accessibility cannot see', async () => {
    const { manager, lockGuestUpright } = duo()
    lockGuestUpright()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))

    const result = await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })

    expect(result.ok).toBe(true)
  })

  it('captures the lit panel rather than simctl\'s default cover', async () => {
    const { manager, capture } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))

    const shot = await manager.screenshot('device-a')
    await manager.startRecording('device-a')

    expect(capture.screenshot).toHaveBeenCalledWith('device-a', shot.path, 3)
    expect(capture.startRecording).toHaveBeenCalledWith('device-a', expect.any(String), 3)
  })

  it('forgets the hinge on shutdown, and refuses one on a single-screen device', async () => {
    const { manager } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))

    await manager.shutdown('device-a')

    expect(await manager.foldPosition('device-a')).toEqual(open(0))

    const flat = setup()
    const single = new IosSimulatorManager({
      simctl: flat.simctl, nativeFactory: flat.nativeFactory, helperProbe: async () => null,
    })
    await expect(single.setFoldPosition('device-a', open(180))).rejects.toThrow(/UNSUPPORTED/)
  })
})
