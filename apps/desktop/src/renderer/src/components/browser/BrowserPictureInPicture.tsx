import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useOnTurnCompleted } from '@/hooks/useOnTurnCompleted'
import { createDragCapture } from '@/lib/drag-capture'
import { getDockApi } from '@/components/activity/activity-panel-api'
import { BrowserView } from './BrowserView'
import {
  browserPipAspect,
  clampBrowserPipLayout,
  createDefaultBrowserPipLayout,
  defaultBrowserPipMaxHeight,
  resolveBrowserPipViewport,
  type BrowserPipBounds,
  type BrowserPipLayout,
} from './browser-pip-layout'

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

const RESIZE_CORNERS: Array<{ corner: ResizeCorner; className: string }> = [
  { corner: 'nw', className: '-left-1 -top-1 cursor-nwse-resize' },
  { corner: 'ne', className: '-right-1 -top-1 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-1 -left-1 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-1 -right-1 cursor-nwse-resize' },
]

const OVERLAY_BACKDROP_PANES: Array<{ key: string; style: React.CSSProperties }> = [
  { key: 'top', style: { left: 0, top: 0, width: '100vw', height: '5vh' } },
  { key: 'bottom', style: { left: 0, bottom: 0, width: '100vw', height: '5vh' } },
  { key: 'left', style: { left: 0, top: '5vh', width: '5vw', height: '90vh' } },
  { key: 'right', style: { right: 0, top: '5vh', width: '5vw', height: '90vh' } },
]

function browserPipBoundary(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-chat-root]')
}

export function BrowserPictureInPicture() {
  const { t } = useTranslation()
  const automationPreviewBrowserId = useBrowserStore((state) => state.automationPreviewBrowserId)
  const expandedBrowserId = useBrowserStore((state) => state.expandedBrowserId)
  const pinnedPipBrowserId = useBrowserStore((state) => state.pinnedPipBrowserId)
  const hiddenPreviewBrowserId = useBrowserStore((state) => state.hiddenPreviewBrowserId)
  const automaticPreviewId = automationPreviewBrowserId !== hiddenPreviewBrowserId
    ? automationPreviewBrowserId
    : null
  const browserId = expandedBrowserId ?? pinnedPipBrowserId ?? automaticPreviewId
  const expanded = browserId != null && expandedBrowserId === browserId
  const owner = useBrowserStore((state) => browserId ? state.tabs[browserId]?.owner ?? null : null)
  const panelSlot = useBrowserStore((state) => browserId ? state.slots[browserId] : undefined)
  const emulation = useBrowserStore((state) => browserId ? state.emulations[browserId] : undefined)
  const pipAspect = browserPipAspect(resolveBrowserPipViewport(emulation, panelSlot))
  const currentSessionId = useChatStore(selectActiveChatSessionId)
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  const mosaicMode = useMosaicStore((state) => state.mode)
  const shouldShow = browserId != null
    && currentSessionId != null
    && owner === currentSessionId
    && !activityShown
    && mosaicMode === 'single'
  const showPip = shouldShow && !expanded

  const [bounds, setBounds] = useState<BrowserPipBounds | null>(null)
  const [layout, setLayout] = useState<BrowserPipLayout | null>(null)
  const [interacting, setInteracting] = useState(false)
  const interactionCleanupRef = useRef<(() => void) | null>(null)
  const pipAspectRef = useRef(pipAspect)

  useOnTurnCompleted(() => useBrowserStore.getState().clearAutomationPreview())

  useEffect(() => {
    if (!activityShown || !browserId) return
    getDockApi()?.panels.find((panel) => panel.id === browserId)?.api.setActive()
    useBrowserStore.getState().clearManualPreview()
  }, [activityShown, browserId])

  useEffect(() => {
    const manualPreviewId = expandedBrowserId ?? pinnedPipBrowserId
    if (!manualPreviewId) return
    if (owner !== currentSessionId || mosaicMode !== 'single') {
      useBrowserStore.getState().clearManualPreview()
    }
  }, [currentSessionId, expandedBrowserId, mosaicMode, owner, pinnedPipBrowserId])

  useLayoutEffect(() => {
    if (!showPip) return
    const boundary = browserPipBoundary()
    if (!boundary) return

    const measure = () => {
      const rect = boundary.getBoundingClientRect()
      const nextBounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      const aspectChanged = pipAspectRef.current !== pipAspect
      pipAspectRef.current = pipAspect
      setBounds(nextBounds)
      setLayout((current) => current
        ? clampBrowserPipLayout(
          current,
          nextBounds,
          pipAspect,
          aspectChanged ? { maxHeight: defaultBrowserPipMaxHeight(nextBounds) } : undefined,
        )
        : createDefaultBrowserPipLayout(nextBounds, pipAspect))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(boundary)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showPip, currentSessionId, pipAspect])

  useLayoutEffect(() => {
    if (!showPip) interactionCleanupRef.current?.()
  }, [showPip])
  useLayoutEffect(() => () => interactionCleanupRef.current?.(), [])

  const startInteraction = useCallback((
    cursor: string,
    onMove: (event: PointerEvent) => void,
  ) => {
    interactionCleanupRef.current?.()
    setInteracting(true)
    const capture = createDragCapture(cursor)
    capture.acquire()
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      capture.release()
      interactionCleanupRef.current = null
      setInteracting(false)
    }
    interactionCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }, [])

  const onPreviewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || !layout || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = layout
    startInteraction('grabbing', (move) => {
      setLayout(clampBrowserPipLayout({
        ...start,
        left: start.left + move.clientX - startX,
        top: start.top + move.clientY - startY,
      }, bounds, pipAspect))
    })
  }, [bounds, layout, pipAspect, startInteraction])

  const startResize = useCallback((corner: ResizeCorner, event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || !layout || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const start = layout
    const west = corner.includes('w')
    const north = corner.includes('n')
    const cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize'
    startInteraction(cursor, (move) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      const fromWidth = start.width + (west ? -dx : dx)
      const fromHeight = (start.height + (north ? -dy : dy)) * pipAspect
      const width = Math.abs(fromWidth - start.width) >= Math.abs(fromHeight - start.width)
        ? fromWidth
        : fromHeight
      const fitted = clampBrowserPipLayout({
        left: start.left,
        top: start.top,
        width,
        height: width / pipAspect,
      }, bounds, pipAspect)
      setLayout(clampBrowserPipLayout({
        ...fitted,
        left: west ? start.left + start.width - fitted.width : start.left,
        top: north ? start.top + start.height - fitted.height : start.top,
      }, bounds, pipAspect))
    })
  }, [bounds, layout, pipAspect, startInteraction])

  const hidePreview = useCallback(() => {
    if (browserId) useBrowserStore.getState().hidePreview(browserId)
  }, [browserId])

  const expandPreview = useCallback(() => {
    if (browserId) useBrowserStore.getState().expandPreview(browserId)
  }, [browserId])

  const shrinkPreview = useCallback(() => {
    if (browserId) useBrowserStore.getState().shrinkPreview(browserId)
  }, [browserId])

  return (
    <AnimatePresence>
      {showPip && browserId && layout && (
        <motion.div
          key={`pip:${browserId}`}
          data-browser-pip=""
          aria-label={t('chat.browser.previewLabel')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="group/browser-pip pointer-events-none fixed overflow-hidden rounded-xl border border-border shadow-2xl"
          style={{
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height,
          }}
        >
          <div className="h-full">
            <BrowserView
              browserId={browserId}
              mode="pip"
              className="pointer-events-none"
              interactive={false}
              showChrome={false}
              trackBoundsContinuously={interacting}
            />
          </div>
          <div
            data-browser-pip-drag-handle=""
            className="pointer-events-auto absolute inset-0 cursor-grab active:cursor-grabbing"
            onPointerDown={onPreviewPointerDown}
          />
          <div
            data-browser-pip-actions=""
            className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-md bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/browser-pip:pointer-events-auto group-hover/browser-pip:opacity-100 group-focus-within/browser-pip:pointer-events-auto group-focus-within/browser-pip:opacity-100"
          >
            <IconButton
              aria-label={t('chat.browser.previewHide')}
              tooltip={t('chat.browser.previewHide')}
              tooltipSide="bottom"
              size="xs"
              variant="ghost"
              onClick={hidePreview}
            >
              <EyeOff />
            </IconButton>
            <IconButton
              aria-label={t('chat.browser.previewExpand')}
              tooltip={t('chat.browser.previewExpand')}
              tooltipSide="bottom"
              size="xs"
              variant="ghost"
              onClick={expandPreview}
            >
              <Maximize2 />
            </IconButton>
          </div>
          {RESIZE_CORNERS.map(({ corner, className }) => (
            <div
              key={corner}
              data-browser-pip-resize={corner}
              className={cn('pointer-events-auto absolute z-20 size-4', className)}
              onPointerDown={(event) => startResize(corner, event)}
            />
          ))}
        </motion.div>
      )}
      {shouldShow && expanded && browserId && (
        <motion.div
          key={`overlay:${browserId}`}
          data-browser-preview-overlay=""
          role="dialog"
          aria-modal="true"
          aria-labelledby="expanded-browser-preview-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-none fixed overflow-hidden rounded-none border border-border shadow-2xl"
          style={{ left: '5vw', top: '5vh', width: '90vw', height: '90vh' }}
        >
          <h2 id="expanded-browser-preview-title" className="sr-only">
            {t('chat.browser.previewExpandedLabel')}
          </h2>
          <div className="h-full">
            <BrowserView
              browserId={browserId}
              mode="overlay"
              className="pointer-events-none"
              interactive
              showChrome={false}
            />
          </div>
          <div
            data-browser-preview-actions=""
            className="pointer-events-auto absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-background/70 p-0.5 shadow-sm backdrop-blur-sm"
          >
            <IconButton
              aria-label={t('chat.browser.previewShrink')}
              tooltip={t('chat.browser.previewShrink')}
              tooltipSide="bottom"
              size="sm"
              variant="ghost"
              onClick={shrinkPreview}
            >
              <Minimize2 />
            </IconButton>
            <IconButton
              aria-label={t('chat.browser.previewHide')}
              tooltip={t('chat.browser.previewHide')}
              tooltipSide="bottom"
              size="sm"
              variant="ghost"
              onClick={hidePreview}
            >
              <EyeOff />
            </IconButton>
          </div>
        </motion.div>
      )}
      {shouldShow && expanded && OVERLAY_BACKDROP_PANES.map((pane) => (
        <motion.div
          key={`overlay-backdrop:${pane.key}`}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-auto fixed bg-background/80 backdrop-blur-sm"
          style={pane.style}
        />
      ))}
    </AnimatePresence>
  )
}
