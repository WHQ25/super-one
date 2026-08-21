/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  IosSimulatorChrome,
  IosSimulatorDevice,
  IosSimulatorSessionState,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'

// Same stand-in as the stage's own tests: VideoDecoder and a 2D context are real
// browser boundaries jsdom has neither of. Recording the canvas each renderer was
// built against is what makes "the stream was never rebuilt" observable.
const video = vi.hoisted(() => ({ builtWith: [] as HTMLCanvasElement[], closed: 0 }))
vi.mock('./ios-simulator-video', () => ({
  preferredIosSimulatorPreviewMode: () => 'native-h264',
  IosSimulatorFrameRenderer: class {
    constructor(canvas: HTMLCanvasElement) { video.builtWith.push(canvas) }
    push() {}
    close() { video.closed += 1 }
  },
}))

import { setDockApi } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { useIosSimulatorPipStore } from '@/stores/ios-simulator-pip'
import { resetIosSimulatorSurfaces } from './ios-simulator-surface'
import { IosSimulatorPanel } from './IosSimulatorPanel'
import { IosSimulatorPictureInPicture } from './IosSimulatorPictureInPicture'

const SESSION_ID = 'session-1'

/**
 * Wait for a view to be ready to hold the picture, then assert about the picture
 * separately.
 *
 * The two have to be split. The arriving view cannot attach until its panel has
 * re-read the device list and rebound — several awaits deep, and slower than
 * `waitFor`'s 1s default on a loaded parallel run — so waiting on the canvas itself
 * conflates "the handover dropped it" with "the panel had not booted yet", and the
 * failure reads identically either way. Waiting on the SHELL instead makes the
 * canvas assertion immediate: `attachIosSimulatorSurface` runs in a layout effect,
 * so by the time the host is in the document the canvas is already inside it.
 */
async function shellIn(scope: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      const host = document.querySelector<HTMLElement>(`${scope} [aria-label="iPhone 17 Pro"]`)
      expect(host).not.toBeNull()
      return host!
    },
    { timeout: 4_000 },
  )
}

const DEVICE: IosSimulatorDevice = {
  udid: 'p17-265',
  name: 'iPhone 17 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  runtimeName: 'iOS 26.5',
  state: 'Booted',
  booted: true,
  available: true,
  ownedBySuperOne: true,
  boundSessionId: SESSION_ID,
}

const STATUS: IosSimulatorStatus = {
  supported: true,
  platform: 'darwin',
  developerDirectory: '/Applications/Xcode.app/Contents/Developer',
  xcodeVersion: '26.5',
  xcodeBuild: '17F77',
  simctlPath: '/usr/bin/xcrun',
  previewMode: 'native-h264',
  helper: null,
}

const READY: IosSimulatorSessionState = {
  sessionId: SESSION_ID,
  device: DEVICE,
  phase: 'ready',
  previewMode: 'native-h264',
  interactive: true,
  orientation: 'portrait',
  hardwareKeyboardConnected: true,
  hardwareKeyboardAvailable: true,
  pixelWidth: 1206,
  pixelHeight: 2622,
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

function stubEnvironment() {
  const openIosSimulatorStream = vi.fn()
  const closeIosSimulatorStream = vi.fn()
  // The setup file installs a get-trap Proxy that ignores its target, so stubs
  // have to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorStatus: vi.fn(async () => STATUS),
      iosSimulatorList: vi.fn(async () => [DEVICE]),
      iosSimulatorBind: vi.fn(async () => READY),
      iosSimulatorChrome: vi.fn(async () => CHROME),
      iosSimulatorInput: vi.fn(async () => ({ ok: true })),
      iosSimulatorCaptureState: vi.fn(async () => null),
      onIosSimulatorFrame: vi.fn(() => () => {}),
      onIosSimulatorRotateGesture: vi.fn(() => () => {}),
      onIosSimulatorSessionState: vi.fn(() => () => {}),
      openIosSimulatorStream,
      closeIosSimulatorStream,
    },
  })
  return { openIosSimulatorStream, closeIosSimulatorStream }
}

/** The element the preview is pinned inside; jsdom reports zeros without this. */
function mountChatRoot() {
  const root = document.createElement('div')
  root.setAttribute('data-chat-root', '')
  root.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect
  document.body.appendChild(root)
}

/**
 * Both surfaces the device can live on, wired the way the app wires them: the
 * floating preview always mounted, the Activity tab appearing when the panel opens.
 * They are in different branches on purpose — that is the whole subject.
 */
function Surfaces() {
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  return (
    <>
      <IosSimulatorPictureInPicture />
      {activityShown && (
        <div data-fake-dock="">
          <IosSimulatorPanel sessionId={SESSION_ID} variant="panel" />
        </div>
      )}
    </>
  )
}

async function renderReadyPreview(node: React.ReactElement = <IosSimulatorPictureInPicture />) {
  mountChatRoot()
  useChatStore.setState({
    activeProject: '/project',
    projectSessions: { '/project': { _activeSessionId: SESSION_ID } },
  } as unknown as Parameters<typeof useChatStore.setState>[0])
  useIosSimulatorPipStore.getState().setReady(SESSION_ID, {
    udid: DEVICE.udid, width: 1206, height: 2622,
  })
  const view = render(node)
  // The canvas only mounts once `bind` has answered AND the artwork lookup has
  // settled, so this is the point where there is a stream to preserve at all.
  await waitFor(() => expect(video.builtWith.length).toBe(1))
  return view
}

beforeEach(() => {
  // Reset FIRST: disposing the previous test's surface closes its renderer, and
  // that close belongs to the test that made it, not to this one.
  resetIosSimulatorSurfaces()
  video.builtWith.length = 0
  video.closed = 0
  document.body.innerHTML = ''
  setDockApi(null)
  useActivityPanelStore.setState({ showPanel: false, maximized: false, maximizedGroupId: null })
  useIosSimulatorPipStore.setState({
    readySessionId: null, expandedSessionId: null, hiddenSessionId: null, device: null,
  })
})

describe('iOS Simulator preview expand and shrink', () => {

  it('keeps the running frame stream when the preview is expanded and shrunk again', async () => {
    const { openIosSimulatorStream, closeIosSimulatorStream } = stubEnvironment()

    await renderReadyPreview()
    expect(openIosSimulatorStream).toHaveBeenCalledTimes(1)
    const canvas = video.builtWith[0]

    // The regression: expanded and shrunk used to be two branches with two keys, so
    // React unmounted the whole panel on the way between them. That re-ran the
    // `simctl` round trips, rebuilt the canvas, and made main tear the helper's
    // encoder down and renegotiate it — seconds of grey glass to resize a box.
    act(() => { useIosSimulatorPipStore.getState().expandPreview(SESSION_ID) })
    await screen.findByRole('dialog')

    act(() => { useIosSimulatorPipStore.getState().shrinkPreview() })
    await waitFor(() => expect(document.querySelector('[data-device-pip]')).not.toBeNull())

    expect(openIosSimulatorStream).toHaveBeenCalledTimes(1)
    expect(closeIosSimulatorStream).not.toHaveBeenCalled()
    expect(video.builtWith).toEqual([canvas])
    expect(video.closed).toBe(0)
    expect(document.body.contains(canvas)).toBe(true)
  })

  it('re-reads neither the device list nor the artwork on the way to expanded', async () => {
    stubEnvironment()

    await renderReadyPreview()
    const list = window.environment.iosSimulatorList as ReturnType<typeof vi.fn>
    const chrome = window.environment.iosSimulatorChrome as ReturnType<typeof vi.fn>
    const listCalls = list.mock.calls.length
    const chromeCalls = chrome.mock.calls.length

    act(() => { useIosSimulatorPipStore.getState().expandPreview(SESSION_ID) })
    await screen.findByRole('dialog')

    // `simctl list devices --json` is a process spawn against CoreSimulatorService,
    // and the artwork lookup gates the canvas behind it. Neither has anything new to
    // say because nothing about the device changed — only the size of its window did.
    expect(list.mock.calls.length).toBe(listCalls)
    expect(chrome.mock.calls.length).toBe(chromeCalls)
  })

  it('hands the device to an Activity tab when the panel opens over a running preview', async () => {
    stubEnvironment()
    const addPanel = vi.fn()
    setDockApi({ panels: [], activePanel: undefined, addPanel } as never)

    await renderReadyPreview()
    // The regression: showing the panel suppresses the preview, and nothing took
    // over. The device kept running with no surface anywhere, so the Activity panel
    // came up on its launcher — reading as though nothing was running at all.
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })

    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: `ios-simulator-${SESSION_ID}`,
      component: 'ios-simulator',
      params: { sessionId: SESSION_ID },
    }))
  })

  it('leaves an existing simulator tab where it is rather than stealing focus', async () => {
    stubEnvironment()
    const addPanel = vi.fn()
    const setActive = vi.fn()
    setDockApi({
      panels: [{ id: `ios-simulator-${SESSION_ID}`, api: { setActive }, group: { id: 'g1' } }],
      activePanel: undefined,
      addPanel,
    } as never)

    await renderReadyPreview()
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })

    // The user may well have opened the panel to get at a terminal. The device
    // already has a home in the tab strip, which is all the invariant asks for.
    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect(addPanel).not.toHaveBeenCalled()
    expect(setActive).not.toHaveBeenCalled()
  })

  it('respects a dismissed preview instead of reopening the device as a tab', async () => {
    stubEnvironment()
    const addPanel = vi.fn()
    setDockApi({ panels: [], activePanel: undefined, addPanel } as never)

    await renderReadyPreview()
    act(() => { useIosSimulatorPipStore.getState().hidePreview(SESSION_ID) })
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })

    // Hiding is about the device, not about the surface it was on.
    expect(addPanel).not.toHaveBeenCalled()
  })

  it('carries the decoded picture from the preview into the Activity tab', async () => {
    const { openIosSimulatorStream, closeIosSimulatorStream } = stubEnvironment()
    setDockApi({ panels: [], activePanel: undefined, addPanel: vi.fn() } as never)

    await renderReadyPreview(<Surfaces />)
    const canvas = video.builtWith[0]

    act(() => { useActivityPanelStore.getState().setShowPanel(true) })
    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect((await shellIn('[data-fake-dock]')).querySelector('canvas')).toBe(canvas)

    // The point of the surface registry. These two views cannot share a tree
    // position, so React must unmount one and mount the other — but the canvas, its
    // decoder and the stream behind them are the SESSION's, not the view's. Rebuilt,
    // the new decoder would sit dark for up to a second waiting on an I-frame, which
    // is what "the preview is reconnecting" looked like.
    expect(video.builtWith).toEqual([canvas])
    expect(video.closed).toBe(0)
    expect(openIosSimulatorStream).toHaveBeenCalledTimes(1)
    expect(closeIosSimulatorStream).not.toHaveBeenCalled()
  })

  it('carries it back when the Activity panel closes again', async () => {
    const { openIosSimulatorStream } = stubEnvironment()
    setDockApi({ panels: [], activePanel: undefined, addPanel: vi.fn() } as never)

    await renderReadyPreview(<Surfaces />)
    const canvas = video.builtWith[0]

    act(() => { useActivityPanelStore.getState().setShowPanel(true) })
    expect((await shellIn('[data-fake-dock]')).querySelector('canvas')).toBe(canvas)
    act(() => { useActivityPanelStore.getState().setShowPanel(false) })
    expect((await shellIn('[data-device-pip]')).querySelector('canvas')).toBe(canvas)

    expect(video.builtWith).toEqual([canvas])
    expect(openIosSimulatorStream).toHaveBeenCalledTimes(1)
  })

  it('opens the expanded overlay from a click that never became a drag', async () => {
    stubEnvironment()

    await renderReadyPreview()
    const handle = document.querySelector('[data-device-pip-drag-handle]')!
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(video.builtWith.length).toBe(1)
  })
})

describe('iOS Simulator preview resizing and dismissal', () => {
  const pip = () => document.querySelector<HTMLElement>('[data-device-pip]')!
  const grip = (edge: string) =>
    document.querySelector<HTMLElement>(`[data-device-pip-resize="${edge}"]`)!

  /** Drag one handle by a delta and read the width it settled on. */
  function dragHandle(edge: string, dx: number, dy: number): number {
    fireEvent.pointerDown(grip(edge), { button: 0, clientX: 400, clientY: 400 })
    fireEvent.pointerMove(window, { clientX: 400 + dx, clientY: 400 + dy })
    const width = Number.parseFloat(pip().style.width)
    fireEvent.pointerUp(window)
    return width
  }

  it('offers a grip on every side as well as every corner', async () => {
    stubEnvironment()
    await renderReadyPreview()

    // Corners alone were unreachable in practice: the device's body is a rounded
    // rect with a ~25%-of-width corner radius, so the box's corners are empty space
    // beyond the visible device. The sides meet the box exactly, so they are where
    // the pointer actually finds an edge.
    const offered = [...document.querySelectorAll('[data-device-pip-resize]')]
      .map((node) => node.getAttribute('data-device-pip-resize'))
    expect(new Set(offered)).toEqual(new Set(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']))
  })

  it('reads only its own axis when the grip is a side', async () => {
    stubEnvironment()
    await renderReadyPreview()
    const start = Number.parseFloat(pip().style.width)

    // Dragging the right edge horizontally is the whole point of a side grip.
    expect(dragHandle('e', 60, 0)).toBeGreaterThan(start)
    // ...and dragging it straight down must do nothing. A corner resolves a mostly
    // vertical drag into a width because it owns both axes; a side that did the same
    // would resize off the axis the hand is not on.
    expect(dragHandle('e', 0, 60)).toBe(Number.parseFloat(pip().style.width))
  })

  it('resizes from a top or bottom grip through the locked aspect', async () => {
    stubEnvironment()
    await renderReadyPreview()
    const start = Number.parseFloat(pip().style.width)

    // The box is aspect-locked, so a vertical grip still has to produce a width —
    // it just has to come from the height rather than from the pointer's x.
    expect(dragHandle('s', 0, 80)).toBeGreaterThan(start)
  })

  it('can be dismissed without expanding it first', async () => {
    stubEnvironment()
    await renderReadyPreview()

    // The eye used to live only in the expanded overlay, so getting a phone off the
    // chat meant opening it up first.
    fireEvent.click(screen.getByLabelText('Hide device preview'))

    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect(useIosSimulatorPipStore.getState().hiddenSessionId).toBe(SESSION_ID)
  })
})
