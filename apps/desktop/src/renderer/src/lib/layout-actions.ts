import { flushSync } from 'react-dom'
import { useAppStore } from '@/stores/app'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { restoreActivityPanel } from '@/components/activity/activity-panel-api'
import { useBrowserStore } from '@/stores/browser'
import { useMiniAppStore } from '@/stores/miniapp'
import { scheduleAllSlotBounds } from '@/hooks/useSlotBounds'
import { ACTIVITY_PANEL_TRANSITION, LAYOUT, maxPanelWidth } from './layout-constants'

const SWAP_DURATION = 300
const SWAP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
const SWAP_SELECTORS = ['[data-activity-outer]', '[data-main-area]'] as const
const HOST_SELECTORS = ['[data-miniapp-host]', '[data-browser-host]'] as const
const SIDEBAR_LOCK_FALLBACK_MS = ACTIVITY_PANEL_TRANSITION.durationMs + 80

let cleanupSidebarLockListeners: (() => void) | null = null

function getCardLeftInset(): number {
  return document.querySelector('[data-main-content][data-card-inset="true"]') ? LAYOUT.CARD_INSET : 0
}

export function cancelSidebarChatLock(): void {
  cleanupSidebarLockListeners?.()
  cleanupSidebarLockListeners = null
  useActivityPanelStore.getState().setLockedChatWidth(null)
}

function lockChatWidthDuringSidebarToggle(sidebarOuter: HTMLElement, mainArea: HTMLElement): void {
  const existing = useActivityPanelStore.getState().lockedChatWidth
  const chatWidth = existing ?? mainArea.getBoundingClientRect().width
  if (chatWidth <= 0) return

  cleanupSidebarLockListeners?.()
  cleanupSidebarLockListeners = null
  useActivityPanelStore.getState().setLockedChatWidth(chatWidth)
  scheduleAllSlotBounds()

  let settled = false
  const finish = (syncWidth: boolean) => {
    if (settled) return
    settled = true
    sidebarOuter.removeEventListener('transitionend', onTransitionEnd)
    clearTimeout(timer)
    cleanupSidebarLockListeners = null

    const ap = useActivityPanelStore.getState()
    if (syncWidth && ap.showPanel && !selectPanelFillsWindow(ap)) {
      const activityOuter = document.querySelector<HTMLElement>('[data-activity-outer]')
      if (activityOuter) {
        const measured = Math.round(activityOuter.getBoundingClientRect().width)
        if (measured >= LAYOUT.MIN_AP) {
          const { showSidebar, sidebarWidth } = useAppStore.getState()
          const cardInset = getCardLeftInset()
          const maxAp = maxPanelWidth(window.innerWidth, showSidebar ? sidebarWidth : 0) + (showSidebar ? cardInset : 0)
          const clamped = Math.max(LAYOUT.MIN_AP, Math.min(measured, maxAp))
          if (clamped !== ap.panelWidth) ap.setPanelWidth(clamped)
        }
      }
    }
    useActivityPanelStore.getState().setLockedChatWidth(null)
  }

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === sidebarOuter && event.propertyName === 'width') finish(true)
  }

  sidebarOuter.addEventListener('transitionend', onTransitionEnd)
  const timer = window.setTimeout(() => finish(true), SIDEBAR_LOCK_FALLBACK_MS)
  cleanupSidebarLockListeners = () => {
    if (settled) return
    settled = true
    sidebarOuter.removeEventListener('transitionend', onTransitionEnd)
    clearTimeout(timer)
  }
}

export function toggleSidebar(): void {
  const { showSidebar, sidebarWidth, setShowSidebar } = useAppStore.getState()
  const ap = useActivityPanelStore.getState()
  const next = !showSidebar

  if (ap.showPanel && !selectPanelFillsWindow(ap)) {
    const cardInset = getCardLeftInset()
    const sidebarDelta = sidebarWidth - cardInset
    const maxAp = maxPanelWidth(window.innerWidth, next ? sidebarWidth : 0) + (next ? cardInset : 0)
    const target = next ? ap.panelWidth - sidebarDelta : ap.panelWidth + sidebarDelta
    ap.setPanelWidth(Math.max(LAYOUT.MIN_AP, Math.min(target, maxAp)))

    const sidebarOuter = document.querySelector<HTMLElement>('[data-sidebar-outer]')
    const mainArea = document.querySelector<HTMLElement>('[data-main-area]')
    if (sidebarOuter && mainArea) {
      lockChatWidthDuringSidebarToggle(sidebarOuter, mainArea)
    }
  } else {
    cancelSidebarChatLock()
  }

  setShowSidebar(next)
}

export function setActivityPanelShown(show: boolean): void {
  const ap = useActivityPanelStore.getState()
  if (show === ap.showPanel) return
  if (!show) cancelSidebarChatLock()
  if (show && !ap.userResized) {
    const { showSidebar, sidebarWidth } = useAppStore.getState()
    const maxAp = maxPanelWidth(window.innerWidth, showSidebar ? sidebarWidth : 0)
    if (maxAp >= LAYOUT.MIN_AP) ap.setPanelWidth(Math.max(LAYOUT.MIN_AP, maxAp))
  }
  ap.setShowPanel(show)
}

export function setChatFloating(floating: boolean, options?: { expanded?: boolean }): void {
  const ap = useActivityPanelStore.getState()
  if (floating) {
    cancelSidebarChatLock()
    setActivityPanelShown(true)
    ap.setChatFloating(true)
    useChatStore.setState({ isOpen: options?.expanded !== false })
    return
  }
  if (ap.maximized) restoreActivityPanel()
  ap.setChatFloating(false)
}

/**
 * Mini-app / browser content lives in fixed host layers driven by slot rects.
 * ResizeObserver only sees size changes, so a pure position jump from the side
 * swap never remeasures them — shift stored lefts by the same delta the panel moved.
 */
function shiftPanelHostSlots(dx: number): void {
  if (dx === 0) return

  const mini = useMiniAppStore.getState()
  for (const [key, slot] of Object.entries(mini.slots)) {
    if (!slot) continue
    mini.updateSlot(key, slot.mode, {
      left: slot.left + dx,
      top: slot.top,
      width: slot.width,
      height: slot.height,
    } as DOMRectReadOnly)
  }

  const browser = useBrowserStore.getState()
  for (const [id, slot] of Object.entries(browser.slots)) {
    if (!slot) continue
    browser.updateSlot(id, slot.mode, {
      left: slot.left + dx,
      top: slot.top,
      width: slot.width,
      height: slot.height,
    } as DOMRectReadOnly)
  }
}

function collectSwapElements(): HTMLElement[] {
  const panels = SWAP_SELECTORS
    .map((sel) => document.querySelector<HTMLElement>(sel))
    .filter((el): el is HTMLElement => el !== null)
  const hosts = HOST_SELECTORS.flatMap((sel) =>
    Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
      // Parked hosts sit at left:-99999; animating them is meaningless noise.
      const left = el.getBoundingClientRect().left
      return left > -10000
    }),
  )
  return [...panels, ...hosts]
}

function flipAnimate(el: HTMLElement, fromLeft: number): Animation | null {
  const dx = fromLeft - el.getBoundingClientRect().left
  if (dx === 0) return null
  return el.animate(
    [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0px)' }],
    { duration: SWAP_DURATION, easing: SWAP_EASING },
  )
}

/**
 * Swap the activity panel between left and right. The swap is a flex `order`
 * flip: positions jump, widths don't change — nothing CSS can transition. So we
 * FLIP it by hand (measure → commit → invert → play) instead of leaving a
 * permanent `layout` animation on the panels, which would also fire on every
 * width change and fight the `transition-[width]` animations.
 *
 * Fixed mini-app / browser hosts are included so their overlays travel with the
 * panel instead of staying glued to the pre-swap coordinates.
 */
export function toggleActivitySide(): void {
  cancelSidebarChatLock()
  const els = collectSwapElements()
  const before = els.map((el) => el.getBoundingClientRect().left)
  const activity = els.find((el) => el.hasAttribute('data-activity-outer'))
  const activityBefore = activity ? before[els.indexOf(activity)] : 0

  // toggleSide only updates the store; the order/layout change lands when React
  // commits. Measuring inside this callback always sees the pre-swap rect (dx=0).
  flushSync(() => {
    useActivityPanelStore.getState().toggleSide()
  })

  // DOM is committed: activity is at its final left; hosts still sit on old slots.
  // Shift slots in a second flushSync so host layers paint at the destination
  // before we FLIP-invert them.
  if (activity) {
    const dx = activity.getBoundingClientRect().left - activityBefore
    flushSync(() => shiftPanelHostSlots(dx))
  }

  const played = els.flatMap((el, i) => {
    const anim = flipAnimate(el, before[i])
    return anim ? [anim] : []
  })

  // A live transform pulls the header out of the macOS app-region drag map;
  // toggling no-drag once the transform is gone forces Chromium to rebuild it.
  void Promise.all(played.map((a) => a.finished)).then(nudgeDragRegions).catch(() => {})
}

function nudgeDragRegions(): void {
  const el = document.querySelector<HTMLElement>('[data-main-area]')
  if (!el) return
  el.style.setProperty('-webkit-app-region', 'no-drag')
  requestAnimationFrame(() => el.style.removeProperty('-webkit-app-region'))
}
