import { buildHeaderRecessClipPath, buildSiblingClipPath } from './chrome-tab-drag'

const TAB_FADE_PX = 24

function fmt(value: number): number {
  return Number(value.toFixed(2))
}

export function getTabFlowLeft(strip: HTMLElement, tab: HTMLElement): number {
  let flowLeft = 0
  for (const child of strip.children) {
    if (child === tab) break
    if (child instanceof HTMLElement && child.classList.contains('dv-tab')) {
      flowLeft += child.offsetWidth
    }
  }
  return flowLeft
}

export function buildTabStripFadeMask({
  viewportWidth,
  scrollLeft,
  scrollWidth,
  activeLeft,
  activeRight,
  flowLeft,
  activeWidth,
  fadePx = TAB_FADE_PX,
}: {
  viewportWidth: number
  scrollLeft: number
  scrollWidth: number
  activeLeft: number
  activeRight: number
  flowLeft: number
  activeWidth: number
  fadePx?: number
}): string {
  const maxScroll = scrollWidth - viewportWidth
  if (viewportWidth <= 0 || maxScroll <= 1) return ''

  const aL = Math.max(0, Math.min(viewportWidth, activeLeft))
  const aR = Math.max(aL, Math.min(viewportWidth, activeRight))

  const outerLeftFade = Math.min(fadePx, Math.max(0, scrollLeft))
  const outerRightFade = Math.min(fadePx, Math.max(0, maxScroll - scrollLeft))
  const innerLeftFade = Math.min(fadePx, Math.max(0, flowLeft + activeWidth - (scrollLeft + viewportWidth)))
  const innerRightFade = Math.min(fadePx, Math.max(0, scrollLeft - flowLeft))

  const leftSpan = aL
  const rightSpan = viewportWidth - aR

  const lOuter = leftSpan > 0.5 ? Math.min(outerLeftFade, innerLeftFade > 0.5 ? leftSpan / 2 : leftSpan) : 0
  const lInner = leftSpan > 0.5 ? Math.min(innerLeftFade, outerLeftFade > 0.5 ? leftSpan / 2 : leftSpan) : 0
  const rInner = rightSpan > 0.5 ? Math.min(innerRightFade, outerRightFade > 0.5 ? rightSpan / 2 : rightSpan) : 0
  const rOuter = rightSpan > 0.5 ? Math.min(outerRightFade, innerRightFade > 0.5 ? rightSpan / 2 : rightSpan) : 0

  if (lOuter <= 0.5 && lInner <= 0.5 && rInner <= 0.5 && rOuter <= 0.5) return ''

  const stops: string[] = []
  const w = fmt(viewportWidth)

  if (leftSpan > 0.5) {
    if (lOuter > 0.5) {
      stops.push('transparent 0px', `#000 ${fmt(lOuter)}px`)
    } else {
      stops.push('#000 0px')
    }
    if (lInner > 0.5) {
      stops.push(`#000 ${fmt(aL - lInner)}px`, `transparent ${fmt(aL)}px`)
    }
  }

  stops.push(`#000 ${fmt(aL)}px`, `#000 ${fmt(aR)}px`)

  if (rightSpan > 0.5) {
    if (rInner > 0.5) {
      stops.push(`transparent ${fmt(aR)}px`, `#000 ${fmt(aR + rInner)}px`)
    }
    if (rOuter > 0.5) {
      stops.push(`#000 ${fmt(viewportWidth - rOuter)}px`, `transparent ${w}px`)
    } else {
      stops.push(`#000 ${w}px`)
    }
  }

  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function watchStickyActiveTabStrip(strip: HTMLElement): () => void {
  const headerEl = strip.closest<HTMLElement>('.dv-tabs-and-actions-container')
  const isDragManaged = () => headerEl?.getAttribute('data-chrome-tab-dragging') === 'true'

  const clearOverflow = () => {
    headerEl?.removeAttribute('data-chrome-tab-overflow')
    if (!isDragManaged()) {
      headerEl?.style.removeProperty('--dv-recess-clip')
      for (const el of strip.querySelectorAll<HTMLElement>('.dv-tab')) {
        el.style.clipPath = ''
      }
    }
    strip.style.maskImage = ''
  }

  const sync = () => {
    if (isDragManaged()) return

    const viewportWidth = strip.clientWidth
    const scrollWidth = strip.scrollWidth
    const activeTab = strip.querySelector<HTMLElement>('.dv-tab.dv-active-tab')
    if (!activeTab || viewportWidth <= 0 || scrollWidth <= viewportWidth + 1) {
      clearOverflow()
      return
    }

    const stripRect = strip.getBoundingClientRect()
    const activeRect = activeTab.getBoundingClientRect()
    if (stripRect.width <= 0 || activeRect.width <= 0) {
      clearOverflow()
      return
    }

    const activeLeft = Math.max(stripRect.left, Math.min(stripRect.right, activeRect.left))
    const activeRight = Math.max(activeLeft, Math.min(stripRect.right, activeRect.right))

    if (headerEl) {
      headerEl.setAttribute('data-chrome-tab-overflow', 'true')
      const hr = headerEl.getBoundingClientRect()
      const headerClip = buildHeaderRecessClipPath(hr.width, hr.height, activeLeft - hr.left, activeRight - hr.left)
      if (headerClip) headerEl.style.setProperty('--dv-recess-clip', headerClip)
      else headerEl.style.removeProperty('--dv-recess-clip')
    }

    for (const el of strip.querySelectorAll<HTMLElement>('.dv-tab')) {
      if (el === activeTab) {
        el.style.clipPath = ''
        continue
      }
      const r = el.getBoundingClientRect()
      el.style.clipPath = buildSiblingClipPath(r.width, r.height, activeLeft - r.left, activeRight - r.left)
    }

    strip.style.maskImage = buildTabStripFadeMask({
      viewportWidth,
      scrollLeft: strip.scrollLeft,
      scrollWidth,
      activeLeft: activeLeft - stripRect.left,
      activeRight: activeRight - stripRect.left,
      flowLeft: getTabFlowLeft(strip, activeTab),
      activeWidth: activeTab.offsetWidth || activeRect.width,
    })
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
  const observeChildren = () => {
    if (!resizeObserver) return
    resizeObserver.observe(strip)
    if (headerEl) resizeObserver.observe(headerEl)
    for (const child of strip.children) {
      if (child instanceof HTMLElement) resizeObserver.observe(child)
    }
  }
  observeChildren()

  const stripMutations = new MutationObserver(() => {
    observeChildren()
    sync()
  })
  stripMutations.observe(strip, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-selected'],
  })

  const headerMutations = headerEl
    ? new MutationObserver(() => {
        if (!isDragManaged()) sync()
      })
    : null
  headerMutations?.observe(headerEl!, {
    attributes: true,
    attributeFilter: ['data-chrome-tab-dragging'],
  })

  strip.addEventListener('scroll', sync, { passive: true })
  sync()

  return () => {
    strip.removeEventListener('scroll', sync)
    stripMutations.disconnect()
    headerMutations?.disconnect()
    resizeObserver?.disconnect()
    clearOverflow()
  }
}

export function watchStickyActiveTabs(root: ParentNode): { scan: () => void; stop: () => void } {
  const watched = new Map<HTMLElement, () => void>()
  const scan = () => {
    for (const strip of root.querySelectorAll<HTMLElement>('.dv-tabs-container')) {
      if (!watched.has(strip)) watched.set(strip, watchStickyActiveTabStrip(strip))
    }
    for (const [strip, stop] of watched) {
      if (!strip.isConnected) {
        stop()
        watched.delete(strip)
      }
    }
  }
  return {
    scan,
    stop: () => {
      for (const stop of watched.values()) stop()
      watched.clear()
    },
  }
}
