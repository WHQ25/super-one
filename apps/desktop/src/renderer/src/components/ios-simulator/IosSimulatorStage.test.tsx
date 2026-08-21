/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  IosSimulatorChrome,
  IosSimulatorDevice,
  IosSimulatorSessionState,
} from '@superone/shared/ios-simulator'

// The frame renderer is a real browser boundary — VideoDecoder and a 2D context,
// neither of which jsdom provides. Standing in for it also records which canvas
// each renderer was built against, which is the whole point of these scenarios.
const video = vi.hoisted(() => ({ builtWith: [] as HTMLCanvasElement[], closed: 0 }))
vi.mock('./ios-simulator-video', () => ({
  preferredIosSimulatorPreviewMode: () => 'native-h264',
  IosSimulatorFrameRenderer: class {
    constructor(canvas: HTMLCanvasElement) { video.builtWith.push(canvas) }
    push() {}
    close() { video.closed += 1 }
  },
}))

import { IosSimulatorStage } from './IosSimulatorStage'

const DEVICE: IosSimulatorDevice = {
  udid: 'p17-265',
  name: 'iPhone 17 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  runtimeName: 'iOS 26.5',
  state: 'Booted',
  booted: true,
  available: true,
  ownedBySuperOne: false,
}

const READY: IosSimulatorSessionState = {
  sessionId: 'session-1',
  device: DEVICE,
  phase: 'ready',
  previewMode: 'native-h264',
  interactive: true,
  orientation: 'portrait',
  hardwareKeyboardConnected: true,
  hardwareKeyboardAvailable: true,
}

const CHROME: IosSimulatorChrome = {
  identifier: 'iPhone17Pro',
  slices: {
    topLeft: 'tl.png', top: 't.png', topRight: 'tr.png', right: 'r.png',
    bottomRight: 'br.png', bottom: 'b.png', bottomLeft: 'bl.png', left: 'l.png',
  },
  corner: 110,
  screenMask: 'data:image/png;base64,AA==',
  width: 438,
  height: 910,
  padding: { top: 0, left: 13, bottom: 0, right: 13 },
  screen: { x: 18, y: 18, width: 402, height: 874 },
  buttons: [],
}

function chromeButton(
  name: string,
  input: NonNullable<IosSimulatorChrome['buttons'][number]['input']>,
): IosSimulatorChrome['buttons'][number] {
  return {
    name,
    title: name,
    anchor: 'left',
    offset: { across: 8, along: 200 },
    hoverOffset: { across: 3, along: 200 },
    width: 16,
    height: 64,
    image: `${name}.png`,
    input,
  }
}

/** What Xcode actually ships for a modern iPhone: side keys on the body, no home. */
const CHROME_WITH_KEYS: IosSimulatorChrome = {
  ...CHROME,
  buttons: [
    chromeButton('volume-up', 'volume-up'),
    chromeButton('volume-down', 'volume-down'),
    chromeButton('power', 'lock'),
  ],
}

function stubEnvironment(chrome: () => Promise<IosSimulatorChrome | null>) {
  const openIosSimulatorStream = vi.fn()
  const closeIosSimulatorStream = vi.fn()
  const stateListeners = new Set<(state: IosSimulatorSessionState) => void>()
  // The setup file installs a get-trap Proxy that ignores its target, so stubs
  // have to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorChrome: vi.fn(chrome),
      iosSimulatorInput: vi.fn(async () => ({ ok: true })),
      onIosSimulatorFrame: vi.fn(() => () => {}),
      onIosSimulatorRotateGesture: vi.fn(() => () => {}),
      onIosSimulatorSessionState: vi.fn((
        _sessionId: string,
        callback: (state: IosSimulatorSessionState) => void,
      ) => {
        stateListeners.add(callback)
        return () => { stateListeners.delete(callback) }
      }),
      openIosSimulatorStream,
      closeIosSimulatorStream,
    },
  })
  return {
    openIosSimulatorStream,
    closeIosSimulatorStream,
    iosSimulatorInput: window.environment.iosSimulatorInput as ReturnType<typeof vi.fn>,
    /** What main pushes when something other than this panel drives the device. */
    pushSessionState: (state: IosSimulatorSessionState) => {
      act(() => { for (const listener of stateListeners) listener(state) })
    },
  }
}

function renderStage(
  sessionState: IosSimulatorSessionState | null = READY,
  overrides: Partial<React.ComponentProps<typeof IosSimulatorStage>> = {},
) {
  const onSelectDevice = vi.fn()
  const onLaunchDevice = vi.fn()
  const stage = (next: IosSimulatorSessionState | null) => (
    <IosSimulatorStage
      sessionId="session-1"
      devices={[DEVICE]}
      device={DEVICE}
      sessionState={next}
      busy={false}
      checking={false}
      launching={false}
      onSelectDevice={onSelectDevice}
      onLaunchDevice={onLaunchDevice}
      onDetach={vi.fn()}
      onTerminate={vi.fn()}
      {...overrides}
    />
  )
  const view = render(stage(sessionState))
  return Object.assign(view, {
    onSelectDevice,
    onLaunchDevice,
    /** The panel fills the session in after `bind` answers; this is that second pass. */
    settleSession: (next: IosSimulatorSessionState) => view.rerender(stage(next)),
  })
}

describe('iOS Simulator stage preview binding', () => {
  beforeEach(() => {
    video.builtWith.length = 0
    video.closed = 0
  })

  it('paints into a canvas that is still in the document once artwork arrives', async () => {
    stubEnvironment(async () => CHROME)

    renderStage()

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    // The regression: the shell swaps component type when artwork resolves, which
    // recreates the canvas. A renderer left holding the old node keeps decoding
    // frames into an element nobody can see.
    const canvas = video.builtWith.at(-1)!
    expect(document.body.contains(canvas)).toBe(true)
  })

  it('builds one renderer when artwork resolves before the canvas mounts', async () => {
    stubEnvironment(async () => CHROME)

    renderStage()

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    // Holding the canvas back until the shell type is known keeps the preview from
    // restarting for a purely cosmetic upgrade.
    expect(video.builtWith).toHaveLength(1)
  })

  it('falls back to the drawn shell when the model ships no artwork', async () => {
    stubEnvironment(async () => null)

    renderStage()

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    expect(document.body.contains(video.builtWith.at(-1)!)).toBe(true)
  })
})

describe('iOS Simulator stage rotation', () => {
  beforeEach(() => {
    video.builtWith.length = 0
  })

  it('steps the guest one quarter turn per press and turns the shell to match', async () => {
    const { iosSimulatorInput } = stubEnvironment(async () => CHROME)
    const user = userEvent.setup()

    renderStage()
    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    const shell = video.builtWith.at(-1)!.closest('[style*="rotate"]')
    expect(shell).toHaveStyle({ transform: 'rotate(0deg)' })

    await user.click(screen.getByRole('button', { name: 'Rotate Right' }))

    // A quarter turn clockwise is `landscapeRight`, not `landscapeLeft`: Apple's
    // name says where the home button lands, not which way the device went, and
    // reading it as a direction puts the guest picture 180deg out.
    expect(iosSimulatorInput).toHaveBeenCalledWith('session-1', {
      type: 'rotate',
      orientation: 'landscape-right',
    })
    await waitFor(() => expect(shell).toHaveStyle({ transform: 'rotate(90deg)' }))
  })

  it('rotates the other way past portrait rather than stopping at it', async () => {
    const { iosSimulatorInput } = stubEnvironment(async () => CHROME)
    const user = userEvent.setup()

    renderStage()
    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: 'Rotate Left' }))

    expect(iosSimulatorInput).toHaveBeenCalledWith('session-1', {
      type: 'rotate',
      orientation: 'landscape-left',
    })
  })

  it('keeps the device centred in the box it is rotated inside', async () => {
    stubEnvironment(async () => CHROME)

    // The shell fits itself to whichever axis runs out first, so on the other axis
    // it is smaller than this wrapper. Under block flow that slack all landed on
    // one side and the rotation flung the device into a different corner per turn.
    renderStage({ ...READY, orientation: 'landscape-left' })

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    const shell = video.builtWith.at(-1)!.closest('[style*="rotate"]')!
    expect(shell.className).toContain('items-center')
    expect(shell.className).toContain('justify-center')
  })

  it('opens on the orientation the device was already left in', async () => {
    stubEnvironment(async () => CHROME)

    // The regression this guards: unmounting the panel and coming back used to
    // draw an upright device over a guest that was still lying on its side.
    renderStage({ ...READY, orientation: 'portrait-upside-down' })

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    expect(video.builtWith.at(-1)!.closest('[style*="rotate"]'))
      .toHaveStyle({ transform: 'rotate(180deg)' })
  })

  it('adopts the orientation that arrives after the panel has already mounted', async () => {
    stubEnvironment(async () => CHROME)

    // The mount order the panel actually produces: it renders this stage with no
    // session at all and fills one in once `bind` answers. Seeding `useState` from
    // `sessionState` therefore only ever read the default, so a device the user had
    // left on its side came back drawn upright with its picture lying inside it —
    // and the scenario above could not catch it, because it hands over a session on
    // the very first render.
    const { settleSession } = renderStage(null)
    settleSession({ ...READY, orientation: 'landscape-right', hardwareKeyboardConnected: false })

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    await waitFor(() => expect(video.builtWith.at(-1)!.closest('[style*="rotate"]'))
      .toHaveStyle({ transform: 'rotate(90deg)' }))
    // The keyboard toggle rides the same seed. With the hardware keyboard already
    // unplugged the guest is drawing its own, so the key offers to put it away —
    // a stale reading here would offer the state the device is already in.
    expect(screen.getByRole('button', { name: 'Hide Software Keyboard' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps a fresh rotation when the device list refreshes underneath it', async () => {
    const { iosSimulatorInput } = stubEnvironment(async () => CHROME)
    const user = userEvent.setup()

    const { settleSession } = renderStage(null)
    settleSession(READY)
    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: 'Rotate Right' }))

    // A refresh re-reads the session but the host has not been told about the turn
    // yet. Syncing on every `sessionState` would snap the device back under the user.
    settleSession({ ...READY, orientation: 'portrait' })

    expect(iosSimulatorInput).toHaveBeenCalledWith('session-1', {
      type: 'rotate', orientation: 'landscape-right',
    })
    expect(video.builtWith.at(-1)!.closest('[style*="rotate"]'))
      .toHaveStyle({ transform: 'rotate(90deg)' })
  })

  it('turns with a rotation the agent performed, not just its own button', async () => {
    const { pushSessionState } = stubEnvironment(async () => CHROME)

    // `device_act` rotates through the main process, which this panel never hears
    // about by polling — orientation has no getter to poll. Without the push the
    // shell stayed upright over a guest lying on its side, and every touch the user
    // aimed after that was mapped a quarter turn out.
    renderStage(READY)
    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    pushSessionState({ ...READY, orientation: 'landscape-left', hardwareKeyboardConnected: false })

    expect(video.builtWith.at(-1)!.closest('[style*="rotate"]'))
      .toHaveStyle({ transform: 'rotate(270deg)' })
    expect(screen.getByRole('button', { name: 'Hide Software Keyboard' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('turns back when the host reports the guest refused the turn', async () => {
    const { pushSessionState } = stubEnvironment(async () => CHROME)
    const user = userEvent.setup()

    renderStage(READY)
    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    // The button turns the shell straight away, so a guest that pins itself upright
    // — the home screen, Spotlight — used to leave the panel lying down alone.
    await user.click(screen.getByRole('button', { name: 'Rotate Right' }))
    pushSessionState(READY)

    expect(video.builtWith.at(-1)!.closest('[style*="rotate"]'))
      .toHaveStyle({ transform: 'rotate(0deg)' })
  })
})

describe('iOS Simulator touch pointer', () => {
  const dot = () => document.querySelector('[data-ios-touch-pointer]')

  beforeEach(() => {
    // jsdom ships no pointer capture, and the input pipeline captures on every
    // contact so a drag off the glass keeps reporting.
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn()
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn()
  })

  it('trades the hover tooltip for a contact dot that tracks the finger', async () => {
    stubEnvironment(async () => CHROME)

    renderStage()
    const canvas = await screen.findByLabelText('iPhone 17 Pro')

    // The regression this guards: the shell carried a native `title`, so every trip
    // across the device dropped a black OS label over the picture.
    expect(canvas.closest('[title]')).toBeNull()

    expect(dot()).toHaveAttribute('data-state', 'idle')
    // React synthesises enter/leave out of over/out, so those are the events to send.
    fireEvent.pointerOver(canvas, { clientX: 20, clientY: 40 })
    expect(dot()).toHaveAttribute('data-state', 'hover')

    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 20, clientY: 40 })
    expect(dot()).toHaveAttribute('data-state', 'press')

    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 20, clientY: 40 })
    expect(dot()).toHaveAttribute('data-state', 'hover')

    fireEvent.pointerOut(canvas, { clientX: 20, clientY: 40 })
    expect(dot()).toHaveAttribute('data-state', 'idle')
  })

  it('draws no finger on a device that cannot take one', async () => {
    stubEnvironment(async () => CHROME)

    // A booted-but-not-interactive device ignores every touch, so a dot following
    // the cursor across it would promise input that goes nowhere.
    renderStage({ ...READY, interactive: false })

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    expect(dot()).toBeNull()
  })
})

describe('iOS Simulator stage hardware keys', () => {
  it('leaves a key out of the toolbar when the body can already be clicked for it', async () => {
    stubEnvironment(async () => CHROME_WITH_KEYS)

    renderStage()

    // Home survives: chrome.json stopped listing it once the button stopped
    // existing, so no artwork carries it however modern the phone is.
    expect(await screen.findByRole('button', { name: 'Home' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lock' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Volume Up' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Volume Down' })).toBeNull()
  })

  it('keeps the whole set when the device has no artwork to press', async () => {
    // The regression this guards: the drawn fallback shell's side buttons are
    // decoration, and most models ship no artwork at all, so dropping the toolbar
    // keys unconditionally would leave them with no way to send volume or lock.
    stubEnvironment(async () => null)

    renderStage()

    for (const name of ['Home', 'Lock', 'Volume Down', 'Volume Up']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
  })
})

describe('iOS Simulator stage software keyboard', () => {
  it('unplugs the simulated hardware keyboard so the guest raises its own', async () => {
    const { iosSimulatorInput } = stubEnvironment(async () => CHROME)
    const user = userEvent.setup()

    renderStage()

    // Plugged in at rest, so the button offers the thing the user cannot otherwise
    // get: iOS only shows its on-screen keyboard when no hardware one is attached.
    await user.click(await screen.findByRole('button', { name: 'Show Software Keyboard' }))

    expect(iosSimulatorInput).toHaveBeenCalledWith('session-1', {
      type: 'keyboard',
      connected: false,
    })
    const back = await screen.findByRole('button', { name: 'Hide Software Keyboard' })
    expect(back).toHaveAttribute('aria-pressed', 'true')

    await user.click(back)
    expect(iosSimulatorInput).toHaveBeenCalledWith('session-1', { type: 'keyboard', connected: true })
  })

  it('offers no switch where CoreSimulator has none', async () => {
    stubEnvironment(async () => CHROME)

    // Greying out a control the user can never reach explains nothing, so an older
    // CoreSimulator that refused the opening state simply has no button.
    renderStage({ ...READY, hardwareKeyboardAvailable: false })

    await waitFor(() => expect(video.builtWith.length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /Software Keyboard/ })).toBeNull()
  })
})

describe('iOS Simulator stage before a device is streaming', () => {
  const SHUTDOWN: IosSimulatorDevice = { ...DEVICE, booted: false, state: 'Shutdown' }

  it('draws the device body with a launch button instead of a bare empty stage', async () => {
    stubEnvironment(async () => CHROME)

    const { onLaunchDevice } = renderStage(null, { device: SHUTDOWN })

    const launch = await screen.findByRole('button', { name: 'Launch' })
    // The body is already on screen — starting it swaps the glass, not the layout.
    expect(document.querySelector('img[src="t.png"]')).not.toBeNull()
    expect(document.querySelector('canvas')).toBeNull()

    await userEvent.click(launch)
    expect(onLaunchDevice).toHaveBeenCalledWith(SHUTDOWN.udid)
  })

  it('offers Connect rather than Launch for a simulator that is already running', async () => {
    stubEnvironment(async () => CHROME)

    renderStage(null)

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull()
  })

  it('keeps the device on screen while it boots, with the notice on its glass', async () => {
    stubEnvironment(async () => CHROME)

    renderStage(null, { device: SHUTDOWN, launching: true })

    // One `waitFor` over both: the shell starts as the drawn body and is replaced by
    // Apple's the moment the artwork lookup lands, so the notice found before that
    // swap belongs to a subtree React has already thrown away. Asserting them
    // together pins the claim to a single commit — body and notice, at once.
    await waitFor(() => {
      expect(document.querySelector('img[src="t.png"]')).not.toBeNull()
      expect(screen.getByText('Launching the simulator…')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull()
  })

  it('keeps the control bar in place, greyed, so nothing shifts when the device boots', async () => {
    stubEnvironment(async () => CHROME)

    renderStage(null, { device: SHUTDOWN })

    for (const name of ['Home', 'Rotate Left', 'Rotate Right', 'Screenshot', 'Record Screen']) {
      expect(await screen.findByRole('button', { name })).toBeDisabled()
    }
  })

  it('greys the header actions that need a binding this session does not hold', async () => {
    stubEnvironment(async () => CHROME)

    // A remembered simulator is drawn and named without ever being bound, so having
    // a device on screen is not the same as having one to disconnect or shut down.
    renderStage(null, { device: SHUTDOWN })

    expect(await screen.findByRole('button', { name: 'Disconnect Preview' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Shut Down Simulator' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preview Quality' })).toBeDisabled()
    // Still reachable: picking another simulator is exactly what you do from here.
    expect(screen.getByRole('button', { name: /iPhone 17 Pro · iOS 26.5/ })).toBeEnabled()
  })

  it('refuses to launch a simulator another session holds, and says why', async () => {
    stubEnvironment(async () => CHROME)

    const { onLaunchDevice } = renderStage(null, {
      device: { ...SHUTDOWN, boundSessionId: 'session-2' },
    })

    const launch = await screen.findByRole('button', { name: 'Launch' })
    expect(launch).toBeDisabled()
    expect(screen.getByText('In use')).toBeInTheDocument()

    await userEvent.click(launch)
    expect(onLaunchDevice).not.toHaveBeenCalled()
  })
})
