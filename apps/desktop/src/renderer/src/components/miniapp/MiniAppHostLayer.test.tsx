/** @vitest-environment jsdom */

import { useEffect, useRef } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { mockOpenMiniAppTab, mockCloseMiniAppTab, appStateRef } = vi.hoisted(() => ({
  mockOpenMiniAppTab: vi.fn(),
  mockCloseMiniAppTab: vi.fn(),
  appStateRef: { currentProjectId: 'proj-1' as string | null },
}))

vi.mock('@/stores/app', () => {
  const getState = () => ({
    currentProjectId: appStateRef.currentProjectId,
  })
  const useAppStore = ((selector?: (s: ReturnType<typeof getState>) => unknown) =>
    selector ? selector(getState()) : getState()) as unknown as { getState: typeof getState } & ((selector?: (s: ReturnType<typeof getState>) => unknown) => unknown)
  useAppStore.getState = getState
  return { useAppStore }
})

vi.mock('@/components/activity/activity-panel-api', () => ({
  openMiniAppTab: mockOpenMiniAppTab,
  closeMiniAppTab: mockCloseMiniAppTab,
}))

vi.mock('@/stores/activity-view-state', () => ({
  isInstanceReferencedInSavedSessions: () => false,
}))

let viewMountCount: Record<string, number> = {}

vi.mock('./MiniAppView', () => ({
  MiniAppView: ({ instanceKey, appId }: { instanceKey: string; appId: string }) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      viewMountCount[instanceKey] = (viewMountCount[instanceKey] ?? 0) + 1
      ref.current?.setAttribute('data-mount-id', String(viewMountCount[instanceKey]))
    }, [instanceKey])
    return <div ref={ref} data-testid={`view-${instanceKey}`} data-app-id={appId}>{instanceKey}</div>
  },
}))

const mockMiniapp = {
  onDevAppReady: vi.fn(() => () => {}),
  list: vi.fn<(projectDir?: string) => Promise<MiniAppEntry[]>>().mockResolvedValue([]),
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  preview: vi.fn(),
  confirmInstall: vi.fn(),
  cancelInstall: vi.fn(),
  uninstall: vi.fn(),
}

;(globalThis as unknown as { window: typeof window }).window = globalThis as unknown as typeof window
;(window as unknown as { miniapp: typeof mockMiniapp }).miniapp = mockMiniapp

function makeEntry(id: string): MiniAppEntry {
  return {
    id,
    installDir: `/install/${id}`,
    manifest: { appId: id, name: `App ${id}`, main: 'node.js' },
  }
}

let useMiniAppStore: typeof import('@/stores/miniapp').useMiniAppStore
let makeInstanceKey: typeof import('@/stores/miniapp').makeInstanceKey
let useActivityPanelStore: typeof import('@/stores/activity-panel').useActivityPanelStore
let useWindowMiniModeStore: typeof import('@/stores/window-mini-mode').useWindowMiniModeStore
let MiniAppHostLayer: typeof import('./MiniAppHostLayer').MiniAppHostLayer

beforeEach(async () => {
  vi.clearAllMocks()
  viewMountCount = {}
  appStateRef.currentProjectId = 'proj-1'
  vi.resetModules()
  ;({ useMiniAppStore, makeInstanceKey } = await import('@/stores/miniapp'))
  ;({ useActivityPanelStore } = await import('@/stores/activity-panel'))
  ;({ useWindowMiniModeStore } = await import('@/stores/window-mini-mode'))
  ;({ MiniAppHostLayer } = await import('./MiniAppHostLayer'))
  act(() => useActivityPanelStore.getState().setShowPanel(true))
})

describe('MiniAppHostLayer persistence', () => {
  it('renders a single MiniAppView per open instance', async () => {
    const { getByTestId, queryByTestId } = render(<MiniAppHostLayer />)
    const key = makeInstanceKey('app-a', 'proj-1')
    expect(queryByTestId(`view-${key}`)).toBeNull()

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })

    expect(getByTestId(`view-${key}`)).toBeInTheDocument()
  })

  it('renders two independent MiniAppViews when the same app is opened from two projects', async () => {
    const { getByTestId } = render(<MiniAppHostLayer />)

    appStateRef.currentProjectId = 'proj-A'
    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj-A')
    })

    appStateRef.currentProjectId = 'proj-B'
    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj-B')
    })

    const keyA = makeInstanceKey('app-a', 'proj-A')
    const keyB = makeInstanceKey('app-a', 'proj-B')
    expect(getByTestId(`view-${keyA}`)).toBeInTheDocument()
    expect(getByTestId(`view-${keyB}`)).toBeInTheDocument()
    expect(getByTestId(`view-${keyA}`)).not.toBe(getByTestId(`view-${keyB}`))
  })

  it('unmounts MiniAppView only when the app is actually closed', async () => {
    const { getByTestId, queryByTestId } = render(<MiniAppHostLayer />)
    const key = makeInstanceKey('app-a', 'proj-1')

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })
    expect(getByTestId(`view-${key}`)).toBeInTheDocument()

    await act(async () => {
      await useMiniAppStore.getState().closeApp(key)
    })
    expect(queryByTestId(`view-${key}`)).toBeNull()
  })

  it('parks panel-mode miniapps off-screen but keeps them sized while the activity panel is collapsed (mosaic keep-alive)', async () => {
    const { container } = render(<MiniAppHostLayer />)
    const key = makeInstanceKey('app-a', 'proj-1')

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })
    act(() => {
      useMiniAppStore.getState().updateSlot(
        key,
        'panel',
        { left: 120, top: 44, width: 560, height: 800 } as DOMRectReadOnly,
      )
    })

    const host = container.querySelector(`[data-instance-key="${key}"]`) as HTMLElement
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')

    act(() => useActivityPanelStore.getState().setShowPanel(false))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('-99999px')
    expect(host.style.width).toBe('560px')
    expect(host.style.height).toBe('800px')
    expect(host.style.pointerEvents).toBe('none')

    act(() => useActivityPanelStore.getState().setShowPanel(true))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')
    expect(host.style.pointerEvents).toBe('auto')
  })

  it('parks panel-mode miniapps when the mini-window fold hides the panel behind the user toggle', async () => {
    const { container } = render(<MiniAppHostLayer />)
    const key = makeInstanceKey('app-a', 'proj-1')

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })
    act(() => {
      useMiniAppStore.getState().updateSlot(
        key,
        'panel',
        { left: 120, top: 44, width: 560, height: 800 } as DOMRectReadOnly,
      )
    })

    const host = container.querySelector(`[data-instance-key="${key}"]`) as HTMLElement
    expect(host.style.left).toBe('120px')

    // The fold shuts both side panels without touching `showPanel` — the user's own
    // toggle has to survive the round trip — so the panel is off screen while the
    // store still says it is open, and its dockview slot stays live and non-zero.
    act(() => useWindowMiniModeStore.setState({ phase: 'mini', panelsFolded: true }))
    expect(useActivityPanelStore.getState().showPanel).toBe(true)
    expect(host.style.left).toBe('-99999px')
    expect(host.style.pointerEvents).toBe('none')

    act(() => useWindowMiniModeStore.setState({ phase: 'app', panelsFolded: false }))
    expect(host.style.left).toBe('120px')
    expect(host.style.pointerEvents).toBe('auto')
  })

  it('positions container by current slot rect and hides when no slot', async () => {
    const { container } = render(<MiniAppHostLayer />)
    const key = makeInstanceKey('app-a', 'proj-1')

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })

    const host = container.querySelector(`[data-instance-key="${key}"]`) as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.display).toBe('none')

    act(() => {
      useMiniAppStore.getState().updateSlot(
        key,
        'panel',
        { left: 100, top: 50, width: 800, height: 600 } as DOMRectReadOnly,
      )
    })
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('100px')
    expect(host.style.top).toBe('50px')
    expect(host.style.width).toBe('800px')
    expect(host.style.height).toBe('600px')

    act(() => {
      useMiniAppStore.getState().unregisterSlot(key, 'panel')
    })
    expect(host.style.display).toBe('none')
  })
})

describe('MiniAppHostLayer drag handling', () => {
  async function mountVisibleApp() {
    const utils = render(<MiniAppHostLayer />)
    const key = makeInstanceKey('app-a', 'proj-1')
    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })
    act(() => {
      useMiniAppStore.getState().updateSlot(
        key,
        'panel',
        { left: 0, top: 44, width: 560, height: 800 } as DOMRectReadOnly,
      )
    })
    const host = utils.container.querySelector(`[data-instance-key="${key}"]`) as HTMLElement
    expect(host.style.pointerEvents).toBe('auto')
    return host
  }

  function dispatchDragOver(types: string[]) {
    act(() => {
      const ev = new Event('dragover', { bubbles: true })
      Object.defineProperty(ev, 'dataTransfer', { value: { types } })
      window.dispatchEvent(ev)
    })
  }

  it('keeps miniapp pointer-events interactive during a file drag so drops reach the webview', async () => {
    const host = await mountVisibleApp()
    dispatchDragOver(['Files'])
    expect(host.style.pointerEvents).toBe('auto')
  })

  it('disables miniapp pointer-events during an internal tab drag so dockview receives it', async () => {
    const host = await mountVisibleApp()
    dispatchDragOver(['application/x-dockview'])
    expect(host.style.pointerEvents).toBe('none')
  })
})
