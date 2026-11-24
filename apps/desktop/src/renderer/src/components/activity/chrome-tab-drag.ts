import type { DockviewApi, DockviewGroupPanel } from 'dockview-core'
import { useActivityDropStore, type DropPosition } from '@/stores/activity-drop'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { FloatingTabDrag, getGridGroups } from './chrome-tab-drag-floating'
import {
  buildHeaderRecessClipPath,
  buildSiblingClipPath,
  findInsertIndexInStrip,
  indicatorBox,
  resolveContentPosition,
  resolveFallbackSplitPosition,
  stepTabOrder,
} from './chrome-tab-drag-geometry'

export { buildHeaderRecessClipPath, buildSiblingClipPath, findInsertIndexInStrip, resolveFallbackSplitPosition, stepTabOrder }

const DRAG_THRESHOLD_PX = 4
const STRIP_DETACH_VERTICAL_PX = 36
const REATTACH_MARGIN_PX = 8
const CLIP_SYNC_DURATION_MS = 200
const SIBLING_TRANSITION = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)'

interface DropTarget {
  group: DockviewGroupPanel
  position: DropPosition
}

interface StripDragContext {
  group: DockviewGroupPanel
  headerEl: HTMLElement | null
  stripEl: HTMLElement
  tabs: HTMLElement[]
  tabEl: HTMLElement
  sourceIndex: number
  rects: DOMRect[]
  widths: number[]
  stripRect: DOMRect
  flowOrigin: number
  naturalLefts: number[]
  order: number[]
  anchorX: number
}

function findGridTabbarAtPoint(
  api: DockviewApi,
  clientX: number,
  clientY: number,
): { group: DockviewGroupPanel; headerEl: HTMLElement; stripEl: HTMLElement } | null {
  for (const group of getGridGroups(api)) {
    const headerEl = group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container')
    const stripEl = headerEl?.querySelector<HTMLElement>('.dv-tabs-container')
    if (!headerEl || !stripEl) continue
    const r = headerEl.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (
      clientX >= r.left
      && clientX <= r.right
      && clientY >= r.top - REATTACH_MARGIN_PX
      && clientY <= r.bottom + REATTACH_MARGIN_PX
    ) {
      return { group, headerEl, stripEl }
    }
  }
  return null
}

function createStripContext(
  group: DockviewGroupPanel,
  stripEl: HTMLElement,
  tabEl: HTMLElement,
  anchorX: number,
  fallbackWidth?: number,
): StripDragContext | null {
  const tabs = Array.from(stripEl.querySelectorAll<HTMLElement>('.dv-tab'))
  const sourceIndex = tabs.indexOf(tabEl)
  if (sourceIndex === -1) return null

  const headerEl = stripEl.closest<HTMLElement>('.dv-tabs-and-actions-container')
  const rects = tabs.map((el) => el.getBoundingClientRect())
  const widths = rects.map((r, i) => (i === sourceIndex && r.width <= 0 && fallbackWidth ? fallbackWidth : r.width))
  const stripRect = stripEl.getBoundingClientRect()
  const flowOrigin = stripRect.left - stripEl.scrollLeft
  const naturalLefts = new Array<number>(tabs.length)
  let flowCursor = flowOrigin
  for (let i = 0; i < tabs.length; i++) {
    naturalLefts[i] = flowCursor
    flowCursor += widths[i]
  }
  return {
    group,
    headerEl,
    stripEl,
    tabs,
    tabEl,
    sourceIndex,
    rects,
    widths,
    stripRect,
    flowOrigin,
    naturalLefts,
    order: tabs.map((_, i) => i),
    anchorX,
  }
}

export function attachChromeTabDrag(container: HTMLElement, api: DockviewApi): () => void {
  const preventNativeTabDrag = (ev: DragEvent) => {
    if (useActivityPanelStore.getState().maximized) return
    const targetEl = ev.target instanceof Element ? ev.target : null
    if (targetEl?.closest('.dv-tab')) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
  }

  const onPointerDown = (startEvent: PointerEvent) => {
    if (startEvent.button !== 0 || useActivityPanelStore.getState().maximized) return
    if (getGridGroups(api).length <= 1 && api.panels.length <= 1) return

    const targetEl = startEvent.target instanceof Element ? startEvent.target : null
    if (!targetEl || targetEl.closest('button')) return

    const initialTabEl = targetEl.closest<HTMLElement>('.dv-tab')
    const initialStripEl = initialTabEl?.parentElement
    if (!initialTabEl || !initialStripEl || !initialStripEl.classList.contains('dv-tabs-container')) return

    const initialGroup = getGridGroups(api).find((g) => g.element.contains(initialTabEl))
    const initialTabs = Array.from(initialStripEl.querySelectorAll<HTMLElement>('.dv-tab'))
    const initialIndex = initialTabs.indexOf(initialTabEl)
    const sourcePanel = initialGroup?.panels[initialIndex]
    if (!initialGroup || !sourcePanel || initialIndex === -1) return

    const initialCtx = createStripContext(initialGroup, initialStripEl, initialTabEl, startEvent.clientX)
    if (!initialCtx) return

    let ctx: StripDragContext | null = initialCtx
    const startX = startEvent.clientX
    const startY = startEvent.clientY
    const grabOffsetX = Math.max(0, startEvent.clientX - initialCtx.rects[initialCtx.sourceIndex].left)
    const grabOffsetY = Math.max(0, startEvent.clientY - initialCtx.rects[initialCtx.sourceIndex].top)
    let tabWidthHint = initialCtx.widths[initialCtx.sourceIndex]

    const floating = new FloatingTabDrag(container, api, sourcePanel, grabOffsetY)
    let dragging = false
    let activeDrop: DropTarget | null = null
    let lastDragLeft = initialCtx.rects[initialCtx.sourceIndex].left
    let lastDragRight = initialCtx.rects[initialCtx.sourceIndex].right
    let clipRaf = 0
    let clipUntil = 0

    const computeSlotLefts = (target: StripDragContext) => {
      const lefts = new Array<number>(target.order.length)
      let cursor = target.flowOrigin
      for (let slot = 0; slot < target.order.length; slot++) {
        lefts[slot] = cursor
        cursor += target.widths[target.order[slot]]
      }
      return lefts
    }

    const applySiblingTransforms = (target: StripDragContext) => {
      const lefts = computeSlotLefts(target)
      for (let slot = 0; slot < target.order.length; slot++) {
        const idx = target.order[slot]
        if (idx === target.sourceIndex) continue
        const dx = lefts[slot] - target.naturalLefts[idx]
        target.tabs[idx].style.transform = dx === 0 ? '' : `translateX(${dx}px)`
      }
    }

    const clearClips = (target: StripDragContext) => {
      target.headerEl?.style.removeProperty('--dv-recess-clip')
      for (let i = 0; i < target.tabs.length; i++) {
        if (i !== target.sourceIndex) target.tabs[i].style.clipPath = ''
      }
    }

    const resetContextStyles = (target: StripDragContext) => {
      target.headerEl?.removeAttribute('data-chrome-tab-dragging')
      clearClips(target)
      for (const el of target.tabs) {
        el.removeAttribute('data-chrome-dragging')
        el.style.transform = ''
        el.style.transition = ''
        el.style.zIndex = ''
        el.style.opacity = ''
        el.style.clipPath = ''
        el.style.pointerEvents = ''
      }
    }

    const enterAttachedStyles = (target: StripDragContext) => {
      target.headerEl?.setAttribute('data-chrome-tab-dragging', 'true')
      target.tabEl.setAttribute('data-chrome-dragging', 'true')
      target.tabEl.style.zIndex = '20'
      target.tabEl.style.pointerEvents = 'none'
      target.tabEl.style.transition = 'none'
      for (let i = 0; i < target.tabs.length; i++) {
        if (i !== target.sourceIndex) {
          target.tabs[i].style.transition = SIBLING_TRANSITION
        }
      }
    }

    const updateSiblingClips = (dragLeft: number, dragRight: number) => {
      if (!ctx) return
      if (ctx.headerEl) {
        const hr = ctx.headerEl.getBoundingClientRect()
        const headerClip = buildHeaderRecessClipPath(hr.width, hr.height, dragLeft - hr.left, dragRight - hr.left)
        if (headerClip) ctx.headerEl.style.setProperty('--dv-recess-clip', headerClip)
        else ctx.headerEl.style.removeProperty('--dv-recess-clip')
      }
      for (let i = 0; i < ctx.tabs.length; i++) {
        if (i === ctx.sourceIndex) continue
        const el = ctx.tabs[i]
        const r = el.getBoundingClientRect()
        el.style.clipPath = buildSiblingClipPath(r.width, r.height, dragLeft - r.left, dragRight - r.left)
      }
    }

    const scheduleClipSync = (durationMs: number) => {
      clipUntil = performance.now() + durationMs
      if (clipRaf) return
      const tick = () => {
        clipRaf = 0
        if (!ctx) return
        const liveRect = ctx.tabEl.offsetWidth > 0 ? ctx.tabEl.getBoundingClientRect() : null
        updateSiblingClips(liveRect ? liveRect.left : lastDragLeft, liveRect ? liveRect.right : lastDragRight)
        if (performance.now() < clipUntil) {
          clipRaf = requestAnimationFrame(tick)
        }
      }
      clipRaf = requestAnimationFrame(tick)
    }

    const joinGridTabbar = (
      targetGroup: DockviewGroupPanel,
      targetStripEl: HTMLElement,
      clientX: number,
    ): boolean => {
      const existingTabs = Array.from(targetStripEl.querySelectorAll<HTMLElement>('.dv-tab'))
      const existingRects = existingTabs.map((el) => el.getBoundingClientRect())
      const desiredCenterX = clientX - floating.grabX + tabWidthHint / 2
      const insertIndex = findInsertIndexInStrip(existingRects, desiredCenterX)

      floating.unmount()
      floating.clearRestoreTarget()
      sourcePanel.api.moveTo({ group: targetGroup, index: insertIndex })

      const newStripEl = targetGroup.element.querySelector<HTMLElement>('.dv-tabs-container')
      const newSourceIndex = targetGroup.panels.indexOf(sourcePanel)
      const newTabs = newStripEl ? Array.from(newStripEl.querySelectorAll<HTMLElement>('.dv-tab')) : []
      const newTabEl = newTabs[newSourceIndex]
      if (!newStripEl || !newTabEl) return false

      const tabLeft = newTabEl.getBoundingClientRect().left
      const nextCtx = createStripContext(targetGroup, newStripEl, newTabEl, tabLeft + floating.grabX, tabWidthHint)
      if (!nextCtx) return false

      ctx = nextCtx
      enterAttachedStyles(ctx)
      scheduleClipSync(CLIP_SYNC_DURATION_MS)
      return true
    }

    const cleanupListeners = () => {
      if (clipRaf) cancelAnimationFrame(clipRaf)
      clipRaf = 0
      if (container.hasPointerCapture?.(startEvent.pointerId)) {
        container.releasePointerCapture(startEvent.pointerId)
      }
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      if (ctx) resetContextStyles(ctx)
      useActivityDropStore.getState().setTabDragging(false)
      useActivityDropStore.getState().setFloatingPanelId(null)
      useActivityDropStore.getState().setIndicator(null)
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel()
    }

    const onPointerMove = (ev: PointerEvent) => {
      const totalDx = ev.clientX - startX
      const totalDy = ev.clientY - startY
      if (!dragging) {
        if (Math.abs(totalDx) <= DRAG_THRESHOLD_PX && Math.abs(totalDy) <= DRAG_THRESHOLD_PX) return
        dragging = true
        container.setPointerCapture?.(startEvent.pointerId)
        useActivityDropStore.getState().setTabDragging(true)
        if (ctx) {
          enterAttachedStyles(ctx)
          scheduleClipSync(CLIP_SYNC_DURATION_MS)
        }
      }

      if (floating.active) {
        const tabbarHit = findGridTabbarAtPoint(api, ev.clientX, ev.clientY)
        if (tabbarHit && joinGridTabbar(tabbarHit.group, tabbarHit.stripEl, ev.clientX)) {
          activeDrop = null
          useActivityDropStore.getState().setIndicator(null)
        } else {
          floating.move(ev.clientX, ev.clientY)
          const under = document.elementFromPoint(ev.clientX, ev.clientY)
          const content = under?.closest('.dv-content-container')
          if (content) {
            const group = getGridGroups(api).find((g) => g.element.contains(content))
            if (group) {
              const r = content.getBoundingClientRect()
              const pos = resolveContentPosition(r, ev.clientX, ev.clientY)
              if (pos) {
                activeDrop = { group, position: pos }
                useActivityDropStore.getState().setIndicator(indicatorBox(r, pos))
                return
              }
            }
          }
          activeDrop = null
          useActivityDropStore.getState().setIndicator(null)
          return
        }
      }

      if (!ctx) return

      const liveStripRect = ctx.stripEl.getBoundingClientRect()
      const activeStripRect = liveStripRect.width > 0 ? liveStripRect : ctx.stripRect
      const shouldDetach =
        ev.clientY < activeStripRect.top - STRIP_DETACH_VERTICAL_PX
        || ev.clientY > activeStripRect.bottom + STRIP_DETACH_VERTICAL_PX

      if (shouldDetach && (getGridGroups(api).length > 1 || ctx.group.panels.length > 1)) {
        if (clipRaf) {
          cancelAnimationFrame(clipRaf)
          clipRaf = 0
        }
        const liveTabRect = ctx.tabEl.offsetWidth > 0 ? ctx.tabEl.getBoundingClientRect() : ctx.rects[ctx.sourceIndex]
        if (liveTabRect.width > 0) tabWidthHint = liveTabRect.width
        const prevCtx = ctx
        floating.detach(prevCtx.group, prevCtx.sourceIndex, tabWidthHint, grabOffsetX, ev.clientX, ev.clientY, () => {
          resetContextStyles(prevCtx)
          ctx = null
        })
        return
      }

      activeDrop = null
      useActivityDropStore.getState().setIndicator(null)
      const dx = ev.clientX - ctx.anchorX
      const liveWidth = ctx.tabEl.offsetWidth || ctx.widths[ctx.sourceIndex]
      const minDx = activeStripRect.left - ctx.rects[ctx.sourceIndex].left
      const maxDx = Math.max(minDx, activeStripRect.right - (ctx.rects[ctx.sourceIndex].left + liveWidth))
      const clampedDx = Math.min(maxDx, Math.max(minDx, dx))
      ctx.tabEl.style.transform = `translateX(${clampedDx}px)`

      const liveTabRect = ctx.tabEl.offsetWidth > 0 ? ctx.tabEl.getBoundingClientRect() : null
      const dragLeft = liveTabRect ? liveTabRect.left : ctx.rects[ctx.sourceIndex].left + clampedDx
      const dragRight = liveTabRect ? liveTabRect.right : ctx.rects[ctx.sourceIndex].right + clampedDx
      lastDragLeft = dragLeft
      lastDragRight = dragRight

      if (stepTabOrder(ctx.order, ctx.sourceIndex, ctx.flowOrigin, ctx.widths, dragLeft)) {
        applySiblingTransforms(ctx)
        scheduleClipSync(CLIP_SYNC_DURATION_MS)
      }
      updateSiblingClips(dragLeft, dragRight)
    }

    const onCancel = () => {
      cleanupListeners()
      if (!dragging) return
      if (floating.active) floating.restore()
      if (!sourcePanel.api.isActive) sourcePanel.api.setActive()
    }

    const onPointerUp = () => {
      const currentCtx = ctx
      const targetSlot = currentCtx ? currentCtx.order.indexOf(currentCtx.sourceIndex) : -1
      const savedScrollLeft = currentCtx ? currentCtx.stripEl.scrollLeft : 0
      const drop = activeDrop
      const wasFloating = floating.active
      cleanupListeners()
      if (!dragging) return

      if (wasFloating) {
        if (drop) {
          floating.unmount()
          floating.clearRestoreTarget()
          sourcePanel.api.moveTo({ group: drop.group, position: drop.position })
        } else {
          floating.restore()
        }
      } else if (currentCtx && targetSlot !== currentCtx.sourceIndex) {
        sourcePanel.api.moveTo({ group: currentCtx.group, index: targetSlot })
        currentCtx.stripEl.scrollLeft = savedScrollLeft
      }

      if (!sourcePanel.api.isActive) sourcePanel.api.setActive()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    window.addEventListener('keydown', onKeyDown)
  }

  container.addEventListener('dragstart', preventNativeTabDrag, true)
  container.addEventListener('pointerdown', onPointerDown)
  return () => {
    container.removeEventListener('dragstart', preventNativeTabDrag, true)
    container.removeEventListener('pointerdown', onPointerDown)
  }
}
