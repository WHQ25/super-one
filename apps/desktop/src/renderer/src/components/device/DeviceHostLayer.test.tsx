/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
// Same stand-in as the stage's own tests: VideoDecoder and a 2D context are real
// browser boundaries jsdom has neither of. Recording the canvas each renderer was
// built against is what makes "the stream was never rebuilt" observable.
const video = vi.hoisted(() => ({ builtWith: [] as HTMLCanvasElement[], closed: 0 }))
vi.mock('./device-video', () => ({
  preferredDevicePreviewMode: () => 'native-h264',
  DeviceFrameRenderer: class {
    constructor(canvas: HTMLCanvasElement) { video.builtWith.push(canvas) }
    push() {}
    close() { video.closed += 1 }
  },
}))

import {
  IOS_SIMULATOR_DEVICE as DEVICE,
  IOS_SIMULATOR_SESSION_ID,
  iosSimulatorRect,
  stubIosSimulatorEnvironment as stubEnvironment,
} from '../../../../test/fixtures/ios-simulator'
import { setDockApi } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { useChatStore } from '@/stores/chat'
import { useDeviceInstanceStore } from '@/stores/device-instances'
import { useDevicePipStore } from '@/stores/device-pip'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { resetDeviceSurfaces } from './device-surface'
import { DeviceHostLayer } from './DeviceHostLayer'
import { DeviceView } from './DeviceView'

const SESSION_ID = IOS_SIMULATOR_SESSION_ID
/**
 * The TAB the device is being watched from. Everything the host layer keys on is
 * this, not the session — a session can have two of them open at once.
 */
const INSTANCE_ID = 'instance-1'

/** Where each surface claims to be. jsdom measures everything as zero without this. */
const SLOT_RECTS: Record<string, DOMRect> = {
  panel: iosSimulatorRect(400, 60, 620, 900),
  pip: iosSimulatorRect(820, 300, 220, 440),
  overlay: iosSimulatorRect(60, 40, 1080, 720),
}
const CHAT_ROOT_RECT = iosSimulatorRect(0, 0, 1200, 800)

/** The element the preview is pinned inside; jsdom reports zeros without this. */
function mountChatRoot() {
  const root = document.createElement('div')
  root.setAttribute('data-chat-root', '')
  document.body.appendChild(root)
}

/**
 * Both surfaces the device can live on, wired the way the app wires them: the host
 * layer always mounted, the Activity tab appearing when the panel opens.
 *
 * Neither surface renders a panel any more — they are holes, and the host layer is
 * the only thing in here that mounts an `DevicePanel`. That is the subject.
 */
function Surfaces() {
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  return (
    <>
      <DeviceHostLayer />
      {activityShown && (
        <div data-fake-dock="">
          <DeviceView instanceId={INSTANCE_ID} mode="panel" />
        </div>
      )}
    </>
  )
}

/**
 * The shape `App.tsx` presents to React: several view branches that each render the
 * host layer as their LAST child, so switching between them is a re-render rather
 * than a remount.
 */
function AppShape({ view }: { view: 'main' | 'settings' }) {
  if (view === 'settings') {
    return <><div data-settings="" /><DeviceHostLayer /></>
  }
  return <><div data-main="" /><DeviceHostLayer /></>
}

const host = () =>
  document.querySelector<HTMLElement>(`[data-device-host][data-instance-id="${INSTANCE_ID}"]`)

/** Where the host has settled — which surface it is drawing on, or nowhere. */
function presentation(): string | null {
  const element = host()
  if (!element) return null
  return element.style.opacity === '0'
    ? 'parked'
    : element.getAttribute('data-device-presentation')
}

async function renderReady(node: React.ReactElement = <DeviceHostLayer />) {
  mountChatRoot()
  useChatStore.setState({
    activeProject: '/project',
    projectSessions: { '/project': { _activeSessionId: SESSION_ID } },
  } as unknown as Parameters<typeof useChatStore.setState>[0])
  useDevicePipStore.getState().setReady(INSTANCE_ID, {
    id: DEVICE.id, provider: DEVICE.provider, platform: DEVICE.platform, width: 1206, height: 2622,
  })
  useAgentViewfinderStore.getState().activate(SESSION_ID, 'device', DEVICE.id)
  const view = render(node)
  // The canvas only mounts once `bind` has answered AND the artwork lookup has
  // settled, so this is the point where there is a stream to preserve at all.
  await waitFor(() => expect(video.builtWith.length).toBe(1))
  return view
}

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect

beforeEach(() => {
  // Reset FIRST: disposing the previous test's surface closes its renderer, and
  // that close belongs to the test that made it, not to this one.
  resetDeviceSurfaces()
  video.builtWith.length = 0
  video.closed = 0
  document.body.innerHTML = ''
  setDockApi(null)
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const mode = this.getAttribute('data-device-slot')
    if (mode && SLOT_RECTS[mode]) return SLOT_RECTS[mode]
    if (this.hasAttribute('data-chat-root')) return CHAT_ROOT_RECT
    return realGetBoundingClientRect.call(this)
  }
  useActivityPanelStore.setState({ showPanel: false, maximized: false, maximizedGroupId: null })
  useWindowMiniModeStore.setState({ mode: null, phase: 'app', panelsFolded: false })
  useDevicePipStore.setState({
    readyInstanceId: null, readyDevices: {}, expandedInstanceId: null, hiddenInstanceId: null, device: null,
    slots: {}, pipSlots: {}, overlaySlots: {},
  })
  useAgentViewfinderStore.setState({ activeBySession: {} })
  useDeviceInstanceStore.setState({
    byId: { [INSTANCE_ID]: { instanceId: INSTANCE_ID, sessionId: SESSION_ID, deviceId: DEVICE.id } },
  })
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect
})

describe('iOS Simulator surface handover', () => {

  it('moves the running panel to the Activity tab instead of rebuilding it there', async () => {
    const { openDeviceStream, closeDeviceStream } = stubEnvironment()
    setDockApi({ panels: [], activePanel: undefined, addPanel: vi.fn() } as never)

    await renderReady(<Surfaces />)
    const canvas = video.builtWith[0]
    const panel = host()
    const list = window.environment.deviceList as ReturnType<typeof vi.fn>
    const chrome = window.environment.iosSimulatorChrome as ReturnType<typeof vi.fn>
    const listCalls = list.mock.calls.length
    const chromeCalls = chrome.mock.calls.length
    await waitFor(() => expect(presentation()).toBe('pip'))

    act(() => { useActivityPanelStore.getState().setShowPanel(true) })
    // Wait on the arbitration, then assert about the picture synchronously. Waiting
    // on the canvas instead would conflate "the handover dropped it" with "the panel
    // had not booted yet" and report both as the same timeout.
    await waitFor(() => expect(presentation()).toBe('panel'))

    // The point of the host layer. The two surfaces cannot share a position in the
    // tree, so a panel rendered by both would be destroyed and rebuilt on every
    // switch — half a second of re-reading the device list, then a fresh decoder
    // sitting dark until the helper's next I-frame, which is up to a second more.
    expect(host()).toBe(panel)
    expect(video.builtWith).toEqual([canvas])
    expect(video.closed).toBe(0)
    expect(openDeviceStream).toHaveBeenCalledTimes(1)
    expect(closeDeviceStream).not.toHaveBeenCalled()
    expect(document.body.contains(canvas)).toBe(true)
    // `simctl list devices --json` is a process spawn against CoreSimulatorService.
    // Nothing about the device changed — only which rect it is drawn in.
    expect(list.mock.calls.length).toBe(listCalls)
    expect(chrome.mock.calls.length).toBe(chromeCalls)
    // ...and it is drawn in the tab's rect, not the preview's.
    expect(host()!.style.left).toBe(`${SLOT_RECTS.panel!.left}px`)
  })

  it('carries it back when the Activity panel closes again', async () => {
    const { openDeviceStream, closeDeviceStream } = stubEnvironment()
    setDockApi({ panels: [], activePanel: undefined, addPanel: vi.fn() } as never)

    await renderReady(<Surfaces />)
    const canvas = video.builtWith[0]
    const panel = host()

    act(() => { useActivityPanelStore.getState().setShowPanel(true) })
    await waitFor(() => expect(presentation()).toBe('panel'))
    act(() => { useActivityPanelStore.getState().setShowPanel(false) })
    await waitFor(() => expect(presentation()).toBe('pip'))

    expect(host()).toBe(panel)
    expect(video.builtWith).toEqual([canvas])
    expect(closeDeviceStream).not.toHaveBeenCalled()
    expect(openDeviceStream).toHaveBeenCalledTimes(1)
    expect(host()!.style.left).toBe(`${SLOT_RECTS.pip!.left}px`)
  })

  it('shows a granted device when the agent addressed it by name', async () => {
    let announce: ((state: import('@superone/shared/device').DeviceState) => void) | null = null
    stubEnvironment()
    window.environment.onAnyDeviceState = vi.fn((listener) => {
      announce = listener
      return () => { announce = null }
    })
    mountChatRoot()
    useChatStore.setState({
      activeProject: '/project',
      projectSessions: { '/project': { _activeSessionId: SESSION_ID } },
    } as unknown as Parameters<typeof useChatStore.setState>[0])
    useDeviceInstanceStore.setState({ byId: {} })
    useAgentViewfinderStore.getState().activate(SESSION_ID, 'device', DEVICE.name)
    render(<DeviceHostLayer />)

    act(() => announce?.({
      deviceId: DEVICE.id,
      owner: SESSION_ID,
      device: DEVICE,
      phase: 'ready',
      interactive: true,
      orientation: 'portrait',
      pixelWidth: 1206,
      pixelHeight: 2622,
    }))

    await waitFor(() => expect(document.querySelector('[data-device-pip]')).not.toBeNull())
    expect(useAgentViewfinderStore.getState().activeBySession[SESSION_ID])
      .toEqual({ kind: 'device', targetId: DEVICE.id })
  })

  it('restores the session device when device_act omits its sole device id', async () => {
    stubEnvironment()
    await renderReady()
    await waitFor(() => expect(document.querySelector('[data-device-pip]')).not.toBeNull())

    // Switching targets/sessions clears the current PiP pointer but deliberately
    // retains per-instance ready metadata. device_act normally omits `device` when
    // this session holds exactly one; that null target still has one safe answer.
    act(() => {
      useAgentViewfinderStore.getState().activate(SESSION_ID, 'browser', 'browser-a')
      useDevicePipStore.getState().setReady(null)
    })
    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())

    act(() => {
      useAgentViewfinderStore.getState().activate(SESSION_ID, 'device', null)
    })

    await waitFor(() => expect(document.querySelector('[data-device-pip]')).not.toBeNull())
    expect(useDevicePipStore.getState().readyInstanceId).toBe(INSTANCE_ID)
  })

  it('survives a switch to Settings and back, but only at a matching child index', async () => {
    stubEnvironment()

    const { rerender } = await renderReady(<AppShape view="main" />)
    const canvas = video.builtWith[0]
    const panel = host()
    const list = window.environment.deviceList as ReturnType<typeof vi.fn>
    const listCalls = list.mock.calls.length

    // Settings is a different `App.tsx` return branch, with no dock and no chat root,
    // so neither surface exists there — only membership keeps the device alive. React
    // preserves a component instance across branches ONLY when its position matches,
    // which is why the layer is rendered in all three at the same index. Give it a
    // different index in one branch and this remounts, re-runs `refresh`, and spends
    // two `simctl list` round trips before it can draw again.
    rerender(<AppShape view="settings" />)
    rerender(<AppShape view="main" />)

    expect(host()).toBe(panel)
    expect(video.builtWith).toEqual([canvas])
    expect(list.mock.calls.length).toBe(listCalls)
  })

  it('hands the device to an Activity tab when the panel opens over a running preview', async () => {
    stubEnvironment()
    const addPanel = vi.fn()
    setDockApi({ panels: [], activePanel: undefined, addPanel } as never)

    await renderReady()
    // The regression: showing the panel suppresses the preview, and nothing took
    // over. The device kept running with no surface anywhere, so the Activity panel
    // came up on its launcher — reading as though nothing was running at all.
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })

    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: `device-${INSTANCE_ID}`,
      component: 'device',
      params: { instanceId: INSTANCE_ID },
    }))
  })

  it('leaves an existing simulator tab where it is rather than stealing focus', async () => {
    stubEnvironment()
    const addPanel = vi.fn()
    const setActive = vi.fn()
    setDockApi({
      panels: [{ id: `device-${INSTANCE_ID}`, api: { setActive }, group: { id: 'g1' } }],
      activePanel: undefined,
      addPanel,
    } as never)

    await renderReady()
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

    await renderReady()
    act(() => { useDevicePipStore.getState().hidePreview(INSTANCE_ID) })
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })

    // Hiding is about the device, not about the surface it was on.
    expect(addPanel).not.toHaveBeenCalled()
  })

  it('lets a dismissed device go, rather than decoding for nobody', async () => {
    stubEnvironment()

    await renderReady()
    const canvas = video.builtWith[0]!
    // Dismissal is the one case where nothing is meant to survive. The device stays
    // bound, but the user has said they are not watching, and a decoder drawing into
    // a canvas nobody can see costs the same as one on screen — so a dismissed
    // tab is deliberately left out of the host layer's membership.
    act(() => { useDevicePipStore.getState().hidePreview(INSTANCE_ID) })

    await waitFor(() => expect(host()).toBeNull())
    // The stream itself closes on the surface registry's handover grace timer rather
    // than here; what this asserts is that nothing is left holding it open.
    expect(document.body.contains(canvas)).toBe(false)
  })
})

describe('iOS Simulator host layer placement', () => {
  const RECT = iosSimulatorRect(120, 44, 560, 800) as DOMRectReadOnly

  it('parks the device off-screen while no surface is asking for it', async () => {
    stubEnvironment()
    await renderReady()

    // Expanded or shrunk, the preview registers a slot; with the Activity panel up
    // and no tab yet there is none at all. Off-screen rather than `display: none`
    // so the stage keeps laying out and measuring its own device body.
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })
    await waitFor(() => expect(presentation()).toBe('parked'))
    expect(host()!.style.left).toBe('-99999px')
  })

  it('keeps the panel alive through the beat when no surface holds a slot', async () => {
    const { openDeviceStream, closeDeviceStream } = stubEnvironment()
    setDockApi({ panels: [], activePanel: undefined, addPanel: vi.fn() } as never)

    await renderReady()
    const canvas = video.builtWith[0]
    const panel = host()
    const list = window.environment.deviceList as ReturnType<typeof vi.fn>
    const listCalls = list.mock.calls.length

    // Opening the panel retires the preview and asks dockview for a tab, and those
    // do not happen in the same frame — the preview finishes fading out before the
    // tab has mounted and measured itself. Membership counts the ready session and
    // not just its slots precisely so the device does not fall through that gap: if
    // it did, the tab would arrive to a torn-down panel and pay the full boot again.
    act(() => { useActivityPanelStore.getState().setShowPanel(true) })
    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect(useDevicePipStore.getState().pipSlots[INSTANCE_ID]).toBeUndefined()
    expect(useDevicePipStore.getState().slots[INSTANCE_ID]).toBeUndefined()

    expect(host()).toBe(panel)
    expect(video.builtWith).toEqual([canvas])
    expect(openDeviceStream).toHaveBeenCalledTimes(1)
    expect(closeDeviceStream).not.toHaveBeenCalled()
    expect(list.mock.calls.length).toBe(listCalls)
  })

  it('does not paint into the dock rect while the activity panel is hidden', async () => {
    stubEnvironment()
    await renderReady()

    // Mosaic mode forces the panel hidden but leaves dockview's layout intact, and
    // clipping does not change `getBoundingClientRect` — so the panel slot stays
    // live and non-zero. Winning on the slot alone would paint the device into a
    // rect the user cannot see.
    act(() => {
      useDevicePipStore.getState().updateSlot(INSTANCE_ID, 'panel', RECT)
      useActivityPanelStore.getState().setShowPanel(false)
    })

    expect(host()!.style.left).not.toBe(`${RECT.left}px`)
  })

  it('does not paint into the dock rect while the mini-window fold holds the panel shut', async () => {
    stubEnvironment()
    await renderReady()

    // The fold deliberately leaves `showPanel` alone so the user's toggle survives
    // the round trip, so the panel is off screen while the store still reads open.
    act(() => {
      useDevicePipStore.getState().updateSlot(INSTANCE_ID, 'panel', RECT)
      useActivityPanelStore.getState().setShowPanel(true)
      useWindowMiniModeStore.setState({ phase: 'mini', panelsFolded: true })
    })

    expect(host()!.style.left).not.toBe(`${RECT.left}px`)
  })

  it('yields pointer events while a dock sash is being dragged', async () => {
    stubEnvironment()
    await renderReady()

    act(() => {
      useDevicePipStore.getState().updateSlot(INSTANCE_ID, 'panel', RECT)
      useActivityPanelStore.getState().setShowPanel(true)
    })
    expect(host()!.style.pointerEvents).toBe('auto')

    // A `fixed` layer paints over `.dv-sash` resize bars and over dockview's
    // drag-to-split drop targets, so panel resizing dies silently wherever it
    // covers them unless it stands aside for the duration.
    const sash = document.createElement('div')
    sash.className = 'dv-sash'
    document.body.appendChild(sash)
    act(() => { fireEvent.pointerDown(sash) })
    expect(host()!.style.pointerEvents).toBe('none')

    act(() => { fireEvent.pointerUp(window) })
    expect(host()!.style.pointerEvents).toBe('auto')
  })

  it('refuses pointer events to the shrunk preview so the drag handle gets them', async () => {
    stubEnvironment()
    await renderReady()
    await waitFor(() => expect(presentation()).toBe('pip'))

    // Shrunk, the device is look-only: the whole box belongs to the gesture that
    // moves it and opens it, and that handle is a sibling painted under the device.
    expect(host()!.style.pointerEvents).toBe('none')
  })
})

describe('iOS Simulator expanded overlay', () => {

  it('paints the card under the device and the buttons over it', async () => {
    stubEnvironment()

    await renderReady()
    act(() => { useDevicePipStore.getState().expandPreview(INSTANCE_ID) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(presentation()).toBe('overlay'))

    // All three are positioned siblings with no z-index, so DOM order IS paint order
    // — and z-index could not fix it if the order were wrong, because the buttons
    // live inside the preview box and cannot out-rank the device unless the whole
    // box does, which would put the card back on top of it.
    const layer = document.querySelector('[data-device-host-layer]')!
    const children = [...layer.children]
    const at = (selector: string) =>
      children.findIndex((child) => child.matches(selector) || child.querySelector(selector))

    // The card would otherwise hide the device behind its `bg-background`...
    expect(at('[data-device-host]')).toBeGreaterThan(at('.bg-background'))
    // ...and a wide device would otherwise swallow shrink and hide.
    expect(at('[data-device-preview-actions]')).toBeGreaterThan(at('[data-device-host]'))
  })


  it('keeps the running frame stream when the preview is expanded and shrunk again', async () => {
    const { openDeviceStream, closeDeviceStream } = stubEnvironment()

    await renderReady()
    expect(openDeviceStream).toHaveBeenCalledTimes(1)
    const canvas = video.builtWith[0]
    const panel = host()

    act(() => { useDevicePipStore.getState().expandPreview(INSTANCE_ID) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(presentation()).toBe('overlay'))

    act(() => { useDevicePipStore.getState().shrinkPreview() })
    await waitFor(() => expect(presentation()).toBe('pip'))

    // Expanding is one device moved and resized, not a second view of it. The slot
    // changes mode under the same panel; nothing is rebuilt on the way through.
    expect(host()).toBe(panel)
    expect(openDeviceStream).toHaveBeenCalledTimes(1)
    expect(closeDeviceStream).not.toHaveBeenCalled()
    expect(video.builtWith).toEqual([canvas])
    expect(video.closed).toBe(0)
    expect(document.body.contains(canvas)).toBe(true)
  })
})
