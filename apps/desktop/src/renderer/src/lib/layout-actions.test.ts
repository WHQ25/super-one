/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'
import { useMiniAppStore } from '@/stores/miniapp'
import { ACTIVITY_PANEL_TRANSITION, LAYOUT } from './layout-constants'
import { cancelSidebarChatLock, toggleSidebar, toggleActivitySide } from './layout-actions'

describe('sidebar toggle width compensation', () => {
  beforeEach(() => {
    cancelSidebarChatLock()
    document.body.innerHTML = ''
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
    useAppStore.setState({ showSidebar: true, sidebarWidth: LAYOUT.MIN_SIDEBAR })
    useActivityPanelStore.setState({ showPanel: true, panelWidth: 400, chatFloating: false, maximized: false, lockedChatWidth: null })
  })

  afterEach(() => {
    cancelSidebarChatLock()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('keeps the main area width constant when hiding the sidebar with the panel open', () => {
    const mainBefore = window.innerWidth - LAYOUT.MIN_SIDEBAR - 400

    toggleSidebar()

    const { showSidebar } = useAppStore.getState()
    const { panelWidth } = useActivityPanelStore.getState()
    expect(showSidebar).toBe(false)
    expect(window.innerWidth - 0 - panelWidth).toBe(mainBefore)
  })

  it('hands the width back to the sidebar when showing it again', () => {
    toggleSidebar()
    toggleSidebar()

    expect(useAppStore.getState().showSidebar).toBe(true)
    expect(useActivityPanelStore.getState().panelWidth).toBe(400)
  })

  it('leaves the panel untouched when it is closed', () => {
    useActivityPanelStore.setState({ showPanel: false, panelWidth: 400 })

    toggleSidebar()

    expect(useActivityPanelStore.getState().panelWidth).toBe(400)
  })

  it('never grows the panel past what the main area minimum allows', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true })
    useActivityPanelStore.setState({ showPanel: true, panelWidth: 400 })

    toggleSidebar()

    const { panelWidth } = useActivityPanelStore.getState()
    expect(panelWidth).toBe(900 - LAYOUT.MIN_MAIN - LAYOUT.CARD_GUTTER)
  })

  it('never shrinks the panel below its minimum when showing the sidebar', () => {
    useAppStore.setState({ showSidebar: false, sidebarWidth: LAYOUT.MIN_SIDEBAR })
    useActivityPanelStore.setState({ showPanel: true, panelWidth: LAYOUT.MIN_AP + 40 })

    toggleSidebar()

    expect(useActivityPanelStore.getState().panelWidth).toBe(LAYOUT.MIN_AP)
  })

  it('accounts for the windowed card left inset so docked chat width stays exact', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-main-content', '')
    wrapper.setAttribute('data-card-inset', 'true')
    document.body.appendChild(wrapper)

    toggleSidebar()
    expect(useActivityPanelStore.getState().panelWidth).toBe(400 + LAYOUT.MIN_SIDEBAR - LAYOUT.CARD_INSET)

    toggleSidebar()
    expect(useActivityPanelStore.getState().panelWidth).toBe(400)
  })

  it('locks chat width while the sidebar width transitions and releases on transitionend', () => {
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-sidebar-outer', '')
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-main-content', '')
    wrapper.setAttribute('data-card-inset', 'true')
    const activity = document.createElement('div')
    activity.setAttribute('data-activity-outer', '')
    activity.getBoundingClientRect = () => ({ width: 715 }) as DOMRect
    const main = document.createElement('div')
    main.setAttribute('data-main-area', '')
    main.getBoundingClientRect = () => ({ width: 875 }) as DOMRect
    wrapper.append(activity, main)
    document.body.append(sidebar, wrapper)

    toggleSidebar()
    expect(useActivityPanelStore.getState().lockedChatWidth).toBe(875)

    const endEvent = new Event('transitionend') as TransitionEvent
    Object.defineProperty(endEvent, 'propertyName', { value: 'width' })
    sidebar.dispatchEvent(endEvent)

    expect(useActivityPanelStore.getState().lockedChatWidth).toBeNull()
    expect(useActivityPanelStore.getState().panelWidth).toBe(715)
  })

  it('keeps the original locked chat width across rapid double toggles and unlocks via fallback timer', () => {
    vi.useFakeTimers()
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-sidebar-outer', '')
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-main-content', '')
    wrapper.setAttribute('data-card-inset', 'true')
    const activity = document.createElement('div')
    activity.setAttribute('data-activity-outer', '')
    activity.getBoundingClientRect = () => ({ width: 400 }) as DOMRect
    const main = document.createElement('div')
    main.setAttribute('data-main-area', '')
    let reportedChatW = 875
    main.getBoundingClientRect = () => ({ width: reportedChatW }) as DOMRect
    wrapper.append(activity, main)
    document.body.append(sidebar, wrapper)

    toggleSidebar()
    expect(useActivityPanelStore.getState().lockedChatWidth).toBe(875)

    reportedChatW = 870
    vi.advanceTimersByTime(120)
    toggleSidebar()
    expect(useActivityPanelStore.getState().lockedChatWidth).toBe(875)

    vi.advanceTimersByTime(ACTIVITY_PANEL_TRANSITION.durationMs + 80)
    expect(useActivityPanelStore.getState().lockedChatWidth).toBeNull()
    expect(useActivityPanelStore.getState().panelWidth).toBe(400)
  })

  it('does not lock chat width when chat is floating', () => {
    useActivityPanelStore.setState({ showPanel: true, panelWidth: 560, chatFloating: true })
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-sidebar-outer', '')
    const main = document.createElement('div')
    main.setAttribute('data-main-area', '')
    main.getBoundingClientRect = () => ({ width: 500 }) as DOMRect
    document.body.append(sidebar, main)

    toggleSidebar()
    expect(useActivityPanelStore.getState().lockedChatWidth).toBeNull()
  })
})

describe('activity panel side swap', () => {
  // jsdom has no layout engine, so each element replays a scripted sequence of
  // left values — one per getBoundingClientRect call.
  const mount = (attr: string, lefts: number[]) => {
    const el = document.createElement('div')
    el.setAttribute(attr, '')
    const reads = [...lefts]
    el.getBoundingClientRect = () => ({ left: reads.shift() ?? lefts[lefts.length - 1] }) as DOMRect
    el.animate = vi.fn(() => ({ finished: Promise.resolve() })) as unknown as HTMLElement['animate']
    document.body.appendChild(el)
    return el
  }

  beforeEach(() => {
    useActivityPanelStore.setState({ side: 'left', showPanel: true, panelWidth: 400 })
    useMiniAppStore.setState({ slots: {} })
    useBrowserStore.setState({ slots: {} })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('inverts the order-flip jump on both panels so the swap animates', () => {
    // left→right: the panel jumps from x=0 to x=600, main from x=400 to x=0.
    // Activity: before-map, post-commit dx, then FLIP measure.
    const ap = mount('data-activity-outer', [0, 600, 600])
    const main = mount('data-main-area', [400, 0])

    toggleActivitySide()

    expect(useActivityPanelStore.getState().side).toBe('right')
    expect(ap.animate).toHaveBeenCalledWith(
      [{ transform: 'translateX(-600px)' }, { transform: 'translateX(0px)' }],
      expect.objectContaining({ duration: 300 }),
    )
    expect(main.animate).toHaveBeenCalledWith(
      [{ transform: 'translateX(400px)' }, { transform: 'translateX(0px)' }],
      expect.objectContaining({ duration: 300 }),
    )
  })

  it('skips the animation for panels that did not move', () => {
    const ap = mount('data-activity-outer', [120, 120, 120])
    mount('data-main-area', [50, 50])

    toggleActivitySide()

    expect(useActivityPanelStore.getState().side).toBe('right')
    expect(ap.animate).not.toHaveBeenCalled()
  })

  it('shifts miniapp and browser host slots and FLIPs visible hosts with the panel', () => {
    // Activity: before 0 → after-commit 600 → FLIP measure 600.
    // Hosts: filter + before 20 → after slot shift 620.
    mount('data-activity-outer', [0, 600, 600])
    mount('data-main-area', [400, 0])
    const miniHost = mount('data-miniapp-host', [20, 20, 620])
    const browserHost = mount('data-browser-host', [20, 20, 620])

    useMiniAppStore.setState({
      slots: { 'app-1': { mode: 'panel', left: 20, top: 40, width: 500, height: 700 } },
    })
    useBrowserStore.setState({
      slots: { 'browser-1': { mode: 'panel', left: 20, top: 80, width: 500, height: 660 } },
    })

    toggleActivitySide()

    expect(useMiniAppStore.getState().slots['app-1']?.left).toBe(620)
    expect(useBrowserStore.getState().slots['browser-1']?.left).toBe(620)
    expect(miniHost.animate).toHaveBeenCalledWith(
      [{ transform: 'translateX(-600px)' }, { transform: 'translateX(0px)' }],
      expect.objectContaining({ duration: 300 }),
    )
    expect(browserHost.animate).toHaveBeenCalledWith(
      [{ transform: 'translateX(-600px)' }, { transform: 'translateX(0px)' }],
      expect.objectContaining({ duration: 300 }),
    )
  })

  it('ignores parked (off-screen) hosts when collecting FLIP targets', () => {
    mount('data-activity-outer', [0, 600, 600])
    mount('data-main-area', [400, 0])
    const parked = mount('data-miniapp-host', [-99999])

    useMiniAppStore.setState({
      slots: { 'app-1': { mode: 'panel', left: 20, top: 40, width: 500, height: 700 } },
    })

    toggleActivitySide()

    // Slot still shifts so the host is correct when it becomes visible again.
    expect(useMiniAppStore.getState().slots['app-1']?.left).toBe(620)
    expect(parked.animate).not.toHaveBeenCalled()
  })
})
