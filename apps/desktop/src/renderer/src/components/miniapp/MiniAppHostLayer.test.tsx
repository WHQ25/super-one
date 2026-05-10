/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { mockSetLayoutMode, mockOpenMiniAppTab, mockCloseMiniAppTab } = vi.hoisted(() => ({
  mockSetLayoutMode: vi.fn(),
  mockOpenMiniAppTab: vi.fn(),
  mockCloseMiniAppTab: vi.fn(),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ setLayoutMode: mockSetLayoutMode }) },
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  openMiniAppTab: mockOpenMiniAppTab,
  closeMiniAppTab: mockCloseMiniAppTab,
}))

let viewMountCount: Record<string, number> = {}

vi.mock('./MiniAppView', () => ({
  MiniAppView: ({ appId }: { appId: string }) => {
    viewMountCount[appId] = (viewMountCount[appId] ?? 0) + 1
    return <div data-testid={`view-${appId}`} data-mount-id={viewMountCount[appId]}>{appId}</div>
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
    manifest: { appId: id, name: `App ${id}`, fullscreen: true },
  }
}

let useMiniAppStore: typeof import('@/stores/miniapp').useMiniAppStore
let MiniAppHostLayer: typeof import('./MiniAppHostLayer').MiniAppHostLayer

beforeEach(async () => {
  vi.clearAllMocks()
  viewMountCount = {}
  vi.resetModules()
  ;({ useMiniAppStore } = await import('@/stores/miniapp'))
  ;({ MiniAppHostLayer } = await import('./MiniAppHostLayer'))
})

describe('MiniAppHostLayer persistence', () => {
  it('renders a single MiniAppView per openApp', async () => {
    const { getByTestId, queryByTestId } = render(<MiniAppHostLayer />)
    expect(queryByTestId('view-app-a')).toBeNull()

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })

    expect(getByTestId('view-app-a')).toBeInTheDocument()
  })

  it('keeps MiniAppView DOM identity stable across panel→canvas→panel migration', async () => {
    const { getByTestId } = render(<MiniAppHostLayer />)

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })

    const initialNode = getByTestId('view-app-a')
    const initialMountId = initialNode.getAttribute('data-mount-id')
    expect(initialMountId).toBe('1')

    act(() => {
      useMiniAppStore.getState().moveAppToCanvas('app-a')
    })
    act(() => {
      useMiniAppStore.getState().moveAppToPanel('app-a')
    })

    const afterMigrationNode = getByTestId('view-app-a')
    expect(afterMigrationNode).toBe(initialNode)
    expect(afterMigrationNode.getAttribute('data-mount-id')).toBe('1')
    expect(viewMountCount['app-a']).toBe(1)
  })

  it('unmounts MiniAppView only when the app is actually closed', async () => {
    const { getByTestId, queryByTestId } = render(<MiniAppHostLayer />)

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })
    expect(getByTestId('view-app-a')).toBeInTheDocument()

    act(() => {
      useMiniAppStore.getState().moveAppToCanvas('app-a')
    })
    expect(getByTestId('view-app-a')).toBeInTheDocument()

    await act(async () => {
      await useMiniAppStore.getState().closeApp('app-a')
    })
    expect(queryByTestId('view-app-a')).toBeNull()
  })

  it('positions container by current slot rect and hides when no slot', async () => {
    const { container } = render(<MiniAppHostLayer />)

    await act(async () => {
      await useMiniAppStore.getState().openAppInPanel(makeEntry('app-a'), '/proj')
    })

    const host = container.querySelector('[data-app-id="app-a"]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.display).toBe('none')

    act(() => {
      useMiniAppStore.getState().updateSlot(
        'app-a',
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
      useMiniAppStore.getState().unregisterSlot('app-a', 'panel')
    })
    expect(host.style.display).toBe('none')
  })
})
