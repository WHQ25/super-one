import { describe, expect, it, vi } from 'vitest'
import type { IosSimulatorSessionState } from '@superone/shared/ios-simulator'
import { IosSimulatorManager } from './ios-simulator-manager'
import { device, setup } from './ios-simulator-manager.fixture'

describe('IosSimulatorManager foldable', () => {
  const open = (hingeDegrees: number) => ({ hingeDegrees, tent: false, laptop: false })

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
    expect(state.fold).toEqual({ hingeDegrees: 0, tent: false, laptop: false, panel: 'cover', panelRotation: 0 })
  })

  it('closes a foldable it finds running, since the hinge cannot be read', async () => {
    const { manager, native } = duo(device({ deviceTypeIdentifier: DUO, state: 'Booted', booted: true }))

    await manager.bind('session-a', 'device-a')

    // An unfolded device left by someone else would show its black cover forever.
    expect(native.fold).toHaveBeenCalledWith(0, expect.any(Number), 1, 'portrait', undefined)
  })

  it('unfolds onto the inner panel and reopens the stream there', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    const stop = manager.subscribePreview('device-a', () => undefined)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalledTimes(1))
    const published: IosSimulatorSessionState[] = []
    manager.onSessionState((state) => published.push(state))

    await manager.setFoldPosition('device-a', open(180))

    expect(native.fold).toHaveBeenCalledWith(1, expect.any(Number), 3, 'portrait', undefined)
    expect(native.startFrames).toHaveBeenCalledTimes(2)
    expect(published.at(-1)).toEqual(expect.objectContaining({
      pixelWidth: 2007,
      pixelHeight: 2853,
      fold: { hingeDegrees: 180, tent: false, laptop: false, panel: 'inner', panelRotation: 90 },
    }))
    expect(await manager.foldPosition('device-a')).toEqual(open(180))
    stop()
    await manager.dispose()
  })

  it('moves to any angle between, which the guest already shows on the inner panel', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')

    await manager.setFoldPosition('device-a', open(162))

    expect(native.fold).toHaveBeenCalledWith(0.9, expect.any(Number), 3, 'portrait', undefined)
    expect(await manager.foldPosition('device-a')).toEqual(open(162))
    // 90-120 is a laptop's, never a book held open.
    await expect(manager.setFoldPosition('device-a', open(100))).rejects.toThrow(/laptop is any opening from 90 to 120/)
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
    await manager.setFoldPosition('device-a', open(150))

    // Closed to open swaps panels; 180 to 120 stays on the inner one.
    expect(native.startFrames).toHaveBeenCalledTimes(2)
    expect(native.fold).toHaveBeenNthCalledWith(1, 1, 600, 3, 'portrait', undefined)
    expect(native.fold).toHaveBeenNthCalledWith(2, 150 / 180, 120, 3, 'portrait', undefined)
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

    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true, laptop: false })

    // Swept closed held on its edge, then stood up: the pose rides the fold, after its sweep.
    expect(native.fold).toHaveBeenLastCalledWith(0, expect.any(Number), 1, 'landscape-right', 'tent')
    // The cover was lit before and is lit now, so the stream keeps its display.
    expect(native.startFrames).toHaveBeenCalledTimes(1)
    expect(published.at(-1)).toEqual(expect.objectContaining({
      orientation: 'landscape-right',
      fold: { hingeDegrees: 60, tent: true, laptop: false, panel: 'cover', panelRotation: 0 },
    }))
    stop()
    await manager.dispose()
  })

  it('stands a tent up from closed whatever the hinge was, and opens it wider without the guest', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))
    native.fold.mockClear()

    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true, laptop: false })
    await manager.setFoldPosition('device-a', { hingeDegrees: 30, tent: true, laptop: false })

    // From open the switch to the tent would be a cover swap that never finishes; a
    // tent's angle after that is the host's alone, since the guest pose has none.
    expect(native.fold.mock.calls.map((call) => [call[0], call[1], call[2], call[4]])).toEqual([[0, 600, 1, 'tent']])
    expect(await manager.foldPosition('device-a')).toEqual({ hingeDegrees: 30, tent: true, laptop: false })
    await expect(manager.setFoldPosition('device-a', { hingeDegrees: 90, tent: true, laptop: false })).rejects.toThrow(/up to 60/)
  })

  it('holds each new form its own way, and leaves a turn alone within one', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true, laptop: false })
    native.fold.mockClear()

    // Out of the tent: opened is held upright again, its inner panel then landscape.
    // The sweep carries it, since a posed guest ignores rotation events; the one that
    // closes out of the tent first stays face down, or the guest's swap never ends.
    await manager.setFoldPosition('device-a', open(180))
    expect(native.fold.mock.calls.map((call) => call[3])).toEqual([undefined, 'portrait'])

    // The user turns it, which turns the pose; a wider or narrower opening keeps that turn.
    await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })
    expect(native.turn).toHaveBeenLastCalledWith('landscape-left', false)
    await manager.setFoldPosition('device-a', open(150))
    expect(native.fold).toHaveBeenLastCalledWith(150 / 180, expect.any(Number), 3, 'landscape-left', undefined)

    // A named posture is a form, so it is held its own way even within one: back upright.
    await manager.setFoldPosition('device-a', open(180), { hold: true })
    expect(native.fold).toHaveBeenLastCalledWith(1, expect.any(Number), 3, 'portrait', undefined)
    // Already there, with no sweep to carry the hold, the pose is turned instead.
    await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })
    native.turn.mockClear()
    await manager.setFoldPosition('device-a', open(180), { hold: true })
    expect(native.turn).toHaveBeenCalledWith('portrait', false)
    await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })

    // Folding shut is a phone again, upright.
    const states: IosSimulatorSessionState[] = []
    manager.onSessionState((state) => states.push(state))
    await manager.setFoldPosition('device-a', open(0))
    expect(native.fold).toHaveBeenLastCalledWith(0, expect.any(Number), 1, 'portrait', undefined)
    expect(states.at(-1)?.orientation).toBe('portrait')
  })

  it('closes on the way out of a tent, since a sweep alone would leave the cover lit', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true, laptop: false })
    native.fold.mockClear()

    await manager.setFoldPosition('device-a', open(150))

    expect(native.fold.mock.calls.map((call) => [call[0], call[2], call[4]])).toEqual([[0, 1, undefined], [150 / 180, 3, undefined]])
    expect(await manager.foldPosition('device-a')).toEqual(open(150))

    native.fold.mockClear()
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true, laptop: false })
    await manager.setFoldPosition('device-a', open(0))
    // Closing from a tent is one sweep: closed already shows the cover. It stays face
    // down through the sweep, then turns upright.
    expect(native.fold.mock.calls.map((call) => [call[0], call[2], call[3], call[4]]))
      .toEqual([[0, 1, 'landscape-right', 'tent'], [0, 1, undefined, undefined]])
    expect(native.turn).toHaveBeenLastCalledWith('portrait', true)
  })

  it('lays an open device as a laptop: turned, swept to the angle, then posed on the inner panel', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))
    native.fold.mockClear()
    const published: IosSimulatorSessionState[] = []
    manager.onSessionState((state) => published.push(state))

    await manager.setFoldPosition('device-a', { hingeDegrees: 100, tent: false, laptop: true })

    // No panel swap, so unlike a tent it need not close first.
    expect(native.fold.mock.calls.map((call) => [call[0], call[2], call[3], call[4]])).toEqual([[100 / 180, 3, 'landscape-right', 'laptop']])
    expect(published.at(-1)).toEqual(expect.objectContaining({
      orientation: 'landscape-right',
      fold: { hingeDegrees: 100, tent: false, laptop: true, panel: 'inner', panelRotation: 90 },
    }))
    await expect(manager.setFoldPosition('device-a', { hingeDegrees: 180, tent: false, laptop: true }))
      .rejects.toThrow(/laptop is any opening from 90 to 120/)
  })

  it('opens a laptop wider without the guest, and sweeps out of it upright', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 100, tent: false, laptop: true })
    native.fold.mockClear()

    await manager.setFoldPosition('device-a', { hingeDegrees: 120, tent: false, laptop: true })
    expect(native.fold).not.toHaveBeenCalled()

    // The sweep out clears the guest's pose; open is held upright again.
    await manager.setFoldPosition('device-a', open(150))
    expect(native.fold.mock.calls.map((call) => [call[0], call[2], call[3], call[4]])).toEqual([[150 / 180, 3, 'portrait', undefined]])
    expect(await manager.foldPosition('device-a')).toEqual(open(150))
  })

  it('stands a turned laptop the new way, so CoreMotion reports the turn', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 100, tent: false, laptop: true })

    await expect(manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' }))
      .resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(native.stand).toHaveBeenCalledWith('laptop', 'landscape-left')
  })

  it('turns the pose of a swept device out of one, which rotation events no longer reach', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', open(180))

    await manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' })

    expect(native.turn).toHaveBeenCalledWith('landscape-left', false)
    expect(native.stand).not.toHaveBeenCalled()
  })

  it('leaves a tent face down when it turns, and reports a pose that would not turn', async () => {
    const { manager, native } = duo()
    await manager.boot('session-a', 'device-a')
    await manager.setFoldPosition('device-a', { hingeDegrees: 60, tent: true, laptop: false })

    await manager.input('device-a', { type: 'rotate', orientation: 'portrait' })
    expect(native.turn).not.toHaveBeenCalled()
    expect(native.stand).not.toHaveBeenCalled()

    await manager.setFoldPosition('device-a', open(180))
    native.turn.mockRejectedValueOnce(new Error('SpringBoard kept tabletop pose 0 held 1'))
    await expect(manager.input('device-a', { type: 'rotate', orientation: 'landscape-left' }))
      .resolves.toEqual({ ok: false, error: 'SpringBoard kept tabletop pose 0 held 1' })
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
