import { flushSync } from 'react-dom'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { LAYOUT } from './layout-constants'

const SWAP_DURATION = 300
const SWAP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
const SWAP_SELECTORS = ['[data-activity-outer]', '[data-main-area]'] as const

/**
 * Toggle the sidebar and hand the freed (or reclaimed) width to the activity
 * panel in the **same commit**, so the two `transition-[width]` animations run
 * in lockstep and the flex-1 main area keeps a constant width — no reflow, no
 * jitter in chat. Compensating a frame later (via rAF) leaves one frame where
 * main is `sidebarWidth` too wide, which is a visible jump at 320px+.
 */
export function toggleSidebar(): void {
  const { showSidebar, sidebarWidth, setShowSidebar } = useAppStore.getState()
  const ap = useActivityPanelStore.getState()
  const next = !showSidebar

  if (ap.showPanel) {
    const maxAp = window.innerWidth - (next ? sidebarWidth : 0) - LAYOUT.MIN_MAIN - LAYOUT.CARD_GUTTER
    const target = next ? ap.panelWidth - sidebarWidth : ap.panelWidth + sidebarWidth
    ap.setPanelWidth(Math.max(LAYOUT.MIN_AP, Math.min(target, maxAp)))
  }

  setShowSidebar(next)
}

/**
 * Swap the activity panel between left and right. The swap is a flex `order`
 * flip: positions jump, widths don't change — nothing CSS can transition. So we
 * FLIP it by hand (measure → commit → invert → play) instead of leaving a
 * permanent `layout` animation on the panels, which would also fire on every
 * width change and fight the `transition-[width]` animations.
 */
export function toggleActivitySide(): void {
  const els = SWAP_SELECTORS
    .map((sel) => document.querySelector<HTMLElement>(sel))
    .filter((el): el is HTMLElement => el !== null)
  const before = els.map((el) => el.getBoundingClientRect().left)

  flushSync(() => useActivityPanelStore.getState().toggleSide())

  const played = els.flatMap((el, i) => {
    const dx = before[i] - el.getBoundingClientRect().left
    if (dx === 0) return []
    return el.animate(
      [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0px)' }],
      { duration: SWAP_DURATION, easing: SWAP_EASING },
    )
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
