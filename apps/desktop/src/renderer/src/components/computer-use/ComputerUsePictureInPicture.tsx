import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'
import { useOwnsViewfinder } from '@/stores/agent-viewfinder'
import { createDragCapture } from '@/lib/drag-capture'
import type { PipBounds, PipLayout } from '@/lib/pip-layout'
import {
  clampComputerPipLayout,
  computerPipAspect,
  computerPipCaptureSize,
  createDefaultComputerPipLayout,
} from './computer-pip-layout'

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

const RESIZE_CORNERS: Array<{ corner: ResizeCorner; className: string }> = [
  { corner: 'nw', className: '-left-1 -top-1 cursor-nwse-resize' },
  { corner: 'ne', className: '-right-1 -top-1 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-1 -left-1 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-1 -right-1 cursor-nwse-resize' },
]

const CLICK_SLOP = 4
const CAPTURE_RESIZE_DEBOUNCE_MS = 120

function pipBoundary(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-chat-root]')
}

export function ComputerUsePictureInPicture() {
  const { t } = useTranslation()
  const currentSessionId = useChatStore(selectActiveChatSessionId)
  const target = useComputerViewfinderStore((state) => (
    currentSessionId ? state.targets[currentSessionId] ?? null : null
  ))
  const frame = useComputerViewfinderStore((state) => (
    currentSessionId ? state.frames[currentSessionId] ?? null : null
  ))
  const hidden = useComputerViewfinderStore((state) => (
    currentSessionId ? state.hiddenSessions[currentSessionId] === true : false
  ))
  const mosaicMode = useMosaicStore((state) => state.mode)
  const owns = useOwnsViewfinder(
    'computer',
    currentSessionId,
    target?.windowId != null ? String(target.windowId) : null,
  )
  const wanted = target?.active === true
    && target.sessionId === currentSessionId
    && mosaicMode === 'single'
    && !hidden
  const showPip = wanted && owns
  const aspect = computerPipAspect(frame
    ? { width: frame.width, height: frame.height }
    : target?.sourceWidth && target.sourceHeight
      ? { width: target.sourceWidth, height: target.sourceHeight }
      : null)

  const [bounds, setBounds] = useState<PipBounds | null>(null)
  const [layout, setLayout] = useState<PipLayout | null>(null)
  const interactionCleanupRef = useRef<(() => void) | null>(null)
  const lastCaptureSizeRef = useRef('')

  useLayoutEffect(() => {
    if (!showPip) return
    const boundary = pipBoundary()
    if (!boundary) return
    const measure = () => {
      const rect = boundary.getBoundingClientRect()
      const nextBounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      setBounds(nextBounds)
      setLayout((current) => current
        ? clampComputerPipLayout(current, nextBounds, aspect)
        : createDefaultComputerPipLayout(nextBounds, aspect))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(boundary)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [aspect, currentSessionId, showPip, target?.windowId])

  useLayoutEffect(() => {
    if (!showPip) interactionCleanupRef.current?.()
  }, [showPip])
  useLayoutEffect(() => () => interactionCleanupRef.current?.(), [])

  useEffect(() => {
    if (!showPip || !target?.sessionId || target.windowId == null || !layout) {
      lastCaptureSizeRef.current = ''
      return
    }
    const windowId = target.windowId
    const captureSize = computerPipCaptureSize(layout, window.devicePixelRatio)
    const requestKey = `${target.sessionId}:${windowId}:${captureSize.width}x${captureSize.height}`
    if (lastCaptureSizeRef.current === requestKey) return
    const timer = window.setTimeout(() => {
      lastCaptureSizeRef.current = requestKey
      void window.app.resizeComputerUseViewfinder(
        target.sessionId,
        windowId,
        captureSize.width,
        captureSize.height,
      ).then((resized) => {
        if (!resized && lastCaptureSizeRef.current === requestKey) {
          lastCaptureSizeRef.current = ''
        }
      }, () => {
        if (lastCaptureSizeRef.current === requestKey) lastCaptureSizeRef.current = ''
      })
    }, CAPTURE_RESIZE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [frame?.height, frame?.width, layout, showPip, target?.sessionId, target?.windowId])

  const startInteraction = useCallback((
    cursor: string,
    onMove: (event: PointerEvent) => void,
    onEnd?: () => void,
  ) => {
    interactionCleanupRef.current?.()
    const capture = createDragCapture(cursor)
    capture.acquire()
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      capture.release()
      interactionCleanupRef.current = null
      onEnd?.()
    }
    interactionCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }, [])

  const focusPreview = useCallback(() => {
    if (target?.sessionId) void window.app.focusComputerUseViewfinder(target.sessionId)
  }, [target?.sessionId])

  const onPreviewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || !layout || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = layout
    let dragging = false
    startInteraction('grabbing', (move) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      if (!dragging && Math.abs(dx) <= CLICK_SLOP && Math.abs(dy) <= CLICK_SLOP) return
      dragging = true
      setLayout(clampComputerPipLayout({
        ...start,
        left: start.left + dx,
        top: start.top + dy,
      }, bounds, aspect))
    }, () => {
      if (!dragging) focusPreview()
    })
  }, [aspect, bounds, focusPreview, layout, startInteraction])

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
      const fromHeight = (start.height + (north ? -dy : dy)) * aspect
      const width = Math.abs(fromWidth - start.width) >= Math.abs(fromHeight - start.width)
        ? fromWidth
        : fromHeight
      const fitted = clampComputerPipLayout({
        left: start.left,
        top: start.top,
        width,
        height: width / aspect,
      }, bounds, aspect)
      setLayout(clampComputerPipLayout({
        ...fitted,
        left: west ? start.left + start.width - fitted.width : start.left,
        top: north ? start.top + start.height - fitted.height : start.top,
      }, bounds, aspect))
    })
  }, [aspect, bounds, layout, startInteraction])

  useEffect(() => {
    if (!target) setLayout(null)
  }, [target])

  const cursorVisible = target?.cursorX != null
    && target.cursorY != null
    && (target.sourceWidth ?? 0) > 0
    && (target.sourceHeight ?? 0) > 0

  return (
    <AnimatePresence>
      {showPip && target && layout && (
        <motion.div
          key={`${target.sessionId}:${target.windowId ?? 'unknown'}`}
          data-computer-use-pip=""
          aria-label={t('chat.computerUsePreview.label')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="group/computer-pip pointer-events-none fixed overflow-hidden rounded-xl border border-border bg-black shadow-2xl"
          style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
        >
          {frame && (
            <img
              aria-hidden="true"
              draggable={false}
              className="size-full object-contain"
              src={`data:image/jpeg;base64,${frame.data}`}
            />
          )}
          {cursorVisible && (
            <motion.span
              aria-hidden="true"
              className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange-500 shadow-md"
              animate={target.pulse ? { scale: [1.7, 1] } : { scale: 1 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              style={{
                left: `${(target.cursorX! / target.sourceWidth!) * 100}%`,
                top: `${(target.cursorY! / target.sourceHeight!) * 100}%`,
              }}
            />
          )}
          <div
            data-computer-use-pip-drag-handle=""
            role="button"
            tabIndex={0}
            aria-label={t('chat.computerUsePreview.focus')}
            className="pointer-events-auto absolute inset-0 cursor-grab rounded-xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={onPreviewPointerDown}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              focusPreview()
            }}
          />
          <div className="pointer-events-none absolute right-1 top-1 z-10 rounded-md bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/computer-pip:pointer-events-auto group-hover/computer-pip:opacity-100 group-focus-within/computer-pip:pointer-events-auto group-focus-within/computer-pip:opacity-100">
            <IconButton
              aria-label={t('chat.computerUsePreview.hide')}
              tooltip={t('chat.computerUsePreview.hide')}
              tooltipSide="bottom"
              size="xs"
              variant="ghost"
              onClick={() => {
                if (!currentSessionId) return
                useComputerViewfinderStore.getState().hide(currentSessionId)
                void window.app.hideComputerUseViewfinder(currentSessionId, target.windowId)
              }}
            >
              <EyeOff />
            </IconButton>
          </div>
          {RESIZE_CORNERS.map(({ corner, className }) => (
            <div
              key={corner}
              data-computer-use-pip-resize={corner}
              className={cn('pointer-events-auto absolute z-20 size-4', className)}
              onPointerDown={(event) => startResize(corner, event)}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
