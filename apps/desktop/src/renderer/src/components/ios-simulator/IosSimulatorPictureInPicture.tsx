import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeOff, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IosSimulatorChrome } from '@superone/shared/ios-simulator'
import { isIosSimulatorLandscape } from '@superone/shared/ios-simulator'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useIosSimulatorPipStore } from '@/stores/ios-simulator-pip'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { createDragCapture } from '@/lib/drag-capture'
import { hasIosSimulatorTab, openIosSimulatorTab } from '@/components/activity/activity-panel-api'
import type { PipBounds, PipLayout } from '@/lib/pip-layout'
import { IosSimulatorPanel } from './IosSimulatorPanel'
import {
  clampIosSimulatorPipLayout,
  createDefaultIosSimulatorPipLayout,
  defaultIosSimulatorPipMaxHeight,
  iosSimulatorPipAspect,
} from './ios-simulator-pip-layout'

type ResizeEdge = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/**
 * Where the box can be grabbed to resize it — eight places, not four, and pulled
 * INWARD rather than sitting a few pixels outside the box.
 *
 * The preview's box is the device's bounding rect, but the device drawn in it is a
 * rounded rectangle with a very large radius: Apple's artwork puts the corner at
 * 110 of a 438-wide body, so on a 220px preview the arc sweeps ~55px. That left the
 * old corner-only handles floating in the empty triangle OUTSIDE the device — to
 * resize you had to find a spot where nothing was drawn, past the visible corner.
 *
 * The edges fix that: along the sides the device meets its box exactly, so a strip
 * on the box edge is a strip on the device's own edge, which is where the hand goes.
 * They also make the corners optional, which matters because the hover actions sit
 * on one of them.
 */
const EDGE_THICKNESS = 'w-2.5' as const
const RESIZE_HANDLES: Array<{ edge: ResizeEdge; className: string }> = [
  // Corners first in source order, higher z below: an overlapping edge must not win.
  { edge: 'nw', className: 'left-0 top-0 size-7 cursor-nwse-resize' },
  { edge: 'ne', className: 'right-0 top-0 size-7 cursor-nesw-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 size-7 cursor-nesw-resize' },
  { edge: 'se', className: 'bottom-0 right-0 size-7 cursor-nwse-resize' },
  { edge: 'n', className: 'inset-x-7 top-0 h-2.5 cursor-ns-resize' },
  { edge: 's', className: 'inset-x-7 bottom-0 h-2.5 cursor-ns-resize' },
  { edge: 'w', className: `inset-y-7 left-0 ${EDGE_THICKNESS} cursor-ew-resize` },
  { edge: 'e', className: `inset-y-7 right-0 ${EDGE_THICKNESS} cursor-ew-resize` },
]

const RESIZE_CURSORS: Record<ResizeEdge, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
}

/** The expanded box: a fixed inset, so the backdrop panes below can be fixed too. */
const EXPANDED_BOX: React.CSSProperties = {
  left: '5vw', top: '5vh', width: '90vw', height: '90vh', zIndex: 51,
}

const OVERLAY_BACKDROP_PANES: Array<{ key: string; style: React.CSSProperties }> = [
  { key: 'top', style: { left: 0, top: 0, width: '100vw', height: '5vh' } },
  { key: 'bottom', style: { left: 0, bottom: 0, width: '100vw', height: '5vh' } },
  { key: 'left', style: { left: 0, top: '5vh', width: '5vw', height: '90vh' } },
  { key: 'right', style: { right: 0, top: '5vh', width: '5vw', height: '90vh' } },
]

/**
 * How far the pointer may travel before a press stops counting as a tap.
 *
 * The preview's whole surface is both the drag handle and the way in, so the two have
 * to be told apart after the fact. Below this the box does not move at all, which is
 * what keeps a click from nudging it a pixel on the way to expanding.
 */
const CLICK_SLOP = 4

function pipBoundary(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-chat-root]')
}

/**
 * Hand the bound device the Activity tab, unless it already has somewhere to be.
 *
 * The invariant both callers serve: a device that is bound and ready is ALWAYS on
 * some visible surface — the floating preview, or a tab. The preview and the panel
 * are mutually exclusive by design, so every moment one of them goes away is a
 * moment the other has to take over, and there are two of them: the grant can land
 * while the panel is already open, or the panel can open onto an already-bound
 * device. Only the first was wired, so opening the panel over a running simulator
 * dropped the preview and left the launcher looking like nothing was running.
 *
 * Two things it deliberately will NOT do. A dismissed preview stays dismissed:
 * hiding is about this device, not about this surface. And an existing tab is left
 * exactly where it is — the user may have opened the panel for a terminal, and
 * re-activating the simulator every time the panel is shown would fight them for it.
 */
function revealIosSimulatorTab(sessionId: string, label: string): void {
  if (useIosSimulatorPipStore.getState().hiddenSessionId === sessionId) return
  if (hasIosSimulatorTab(sessionId)) return
  openIosSimulatorTab(sessionId, label)
}

/**
 * Watch the active session's simulator so the preview can appear on its own.
 *
 * Mounted unconditionally, above the visibility test: the whole point is to notice the
 * moment `device_request_launch` is approved, and a hook that only ran while the
 * preview was already showing could never see it.
 *
 * Main pushes state on change only, so a window opened onto an already-bound session
 * shows nothing until something moves. That is deliberate — the preview is a reaction
 * to a grant, not a permanent second copy of the Activity panel.
 */
function useIosSimulatorPresence(sessionId: string | null): void {
  const openTabLabel = useTranslation().t('activity.iosSimulator.title')
  useEffect(() => {
    if (!sessionId) {
      useIosSimulatorPipStore.getState().setReady(null)
      return
    }
    return window.environment.onIosSimulatorSessionState(sessionId, (state) => {
      const bound = state.phase === 'ready' ? state.device : null
      const store = useIosSimulatorPipStore.getState()
      if (!bound) {
        if (store.readySessionId === sessionId) store.setReady(null)
        return
      }
      // Only the transition into ready, never a republish: rotation and the hardware
      // keyboard push state through this same channel, and reacting to those would
      // yank the dock to the simulator tab every time the agent turned the device.
      const arriving = store.readySessionId !== sessionId
      // A republish IS how a rotation arrives, though, and the preview box is the
      // device's outline — so the shape is read every time. The framebuffer never
      // turns with the guest, so a device on its side is the same numbers swapped.
      const turned = isIosSimulatorLandscape(state.orientation)
      const width = (turned ? state.pixelHeight : state.pixelWidth) ?? 0
      const height = (turned ? state.pixelWidth : state.pixelHeight) ?? 0
      store.setReady(sessionId, { udid: bound.udid, width, height })
      // The preview is suppressed while the Activity panel is up, so a grant that
      // lands then would show the user nothing at all. Give it the tab instead —
      // whichever surface is available, approving a device has to reveal one.
      if (arriving && useActivityPanelStore.getState().showPanel) {
        revealIosSimulatorTab(sessionId, openTabLabel)
      }
    })
  }, [sessionId, openTabLabel])
}

/**
 * Apple's artwork for the bound device — read for its OUTLINE, not to draw with.
 *
 * The stage loads the same thing to render it; this second read is what tells the box
 * what shape to be. Loading it here rather than having the stage report upwards keeps
 * the layout decision in the component that owns the layout, and costs nothing: main
 * coalesces the lookup per device type.
 *
 * `null` covers both "still loading" and "this model ships none", which want the same
 * answer — the framebuffer's own shape, which is what the bare-glass shell draws.
 */
function useIosSimulatorChrome(udid: string | null): IosSimulatorChrome | null {
  const [chrome, setChrome] = useState<IosSimulatorChrome | null>(null)
  useEffect(() => {
    setChrome(null)
    if (!udid) return
    let cancelled = false
    void window.environment.iosSimulatorChrome(udid)
      .then((next) => { if (!cancelled) setChrome(next) })
      // Missing artwork is not an error here any more than it is in the stage.
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [udid])
  return chrome
}

/**
 * The simulator as a floating preview over the chat, mirroring the browser's.
 *
 * Renders `IosSimulatorPanel` rather than a device view of its own, because the frame
 * stream is owned per session by whichever stage is mounted: two stages would fight
 * over `openIosSimulatorStream`, and the one that unmounted first would close the
 * stream out from under the other. Showing this only while the Activity panel is
 * hidden keeps exactly one stage alive at any moment.
 *
 * Shrunk, it is the device and nothing else — no panel chrome, no controls, no card
 * behind it: a phone lying on the chat, which can be moved, resized and clicked to
 * open. Every control the panel has lives in the expanded overlay, where there is
 * room to hit them.
 */
export function IosSimulatorPictureInPicture() {
  const { t } = useTranslation()
  const currentSessionId = useChatStore(selectActiveChatSessionId)
  useIosSimulatorPresence(currentSessionId)

  const readySessionId = useIosSimulatorPipStore((state) => state.readySessionId)
  const expandedSessionId = useIosSimulatorPipStore((state) => state.expandedSessionId)
  const hiddenSessionId = useIosSimulatorPipStore((state) => state.hiddenSessionId)
  const device = useIosSimulatorPipStore((state) => state.device)
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  const mosaicMode = useMosaicStore((state) => state.mode)

  const sessionId = readySessionId
  // Bound, belonging to the conversation on screen, and not dismissed: the conditions
  // under which the device has earned a surface. WHICH surface is the next two lines'
  // business — the preview when there is room for it, the Activity tab otherwise.
  const deviceOnScreen = sessionId != null
    && sessionId === currentSessionId
    && sessionId !== hiddenSessionId
  const shouldShow = deviceOnScreen
    && !activityShown
    && mosaicMode === 'single'
  const expanded = shouldShow && expandedSessionId === sessionId
  const showPip = shouldShow && !expanded
  const chrome = useIosSimulatorChrome(device?.udid ?? null)
  const aspect = iosSimulatorPipAspect(device, chrome)

  const [bounds, setBounds] = useState<PipBounds | null>(null)
  const [layout, setLayout] = useState<PipLayout | null>(null)
  const interactionCleanupRef = useRef<(() => void) | null>(null)
  const aspectRef = useRef(aspect)

  // Opening the Activity panel takes the device back to its tab; the preview exists
  // only for the case where there is nowhere else to watch it. Which means the tab
  // has to actually be there — the shrink below is what makes the preview go away,
  // so without the reveal beside it the device goes away with it.
  useEffect(() => {
    if (!activityShown) return
    useIosSimulatorPipStore.getState().shrinkPreview()
    if (deviceOnScreen && sessionId) revealIosSimulatorTab(sessionId, t('activity.iosSimulator.title'))
  }, [activityShown, deviceOnScreen, sessionId, t])

  useLayoutEffect(() => {
    if (!showPip) return
    const boundary = pipBoundary()
    if (!boundary) return

    const measure = () => {
      const rect = boundary.getBoundingClientRect()
      const nextBounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      // A device turning on its side is a new shape, not a new size. Re-fitting it
      // under the DEFAULT height ceiling is what keeps a landscape phone from
      // inheriting a portrait box's height and spanning the whole chat.
      const turned = aspectRef.current !== aspect
      aspectRef.current = aspect
      setBounds(nextBounds)
      setLayout((current) => current
        ? clampIosSimulatorPipLayout(
          current,
          nextBounds,
          aspect,
          turned ? { maxHeight: defaultIosSimulatorPipMaxHeight(nextBounds) } : undefined,
        )
        : createDefaultIosSimulatorPipLayout(nextBounds, aspect))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(boundary)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showPip, currentSessionId, aspect])

  useLayoutEffect(() => {
    if (!showPip) interactionCleanupRef.current?.()
  }, [showPip])
  useLayoutEffect(() => () => interactionCleanupRef.current?.(), [])

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

  const hidePreview = useCallback(() => {
    if (sessionId) useIosSimulatorPipStore.getState().hidePreview(sessionId)
  }, [sessionId])

  const expandPreview = useCallback(() => {
    if (sessionId) useIosSimulatorPipStore.getState().expandPreview(sessionId)
  }, [sessionId])

  const shrinkPreview = useCallback(() => {
    useIosSimulatorPipStore.getState().shrinkPreview()
  }, [])

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
      setLayout(clampIosSimulatorPipLayout({
        ...start,
        left: start.left + dx,
        top: start.top + dy,
      }, bounds, aspect))
    }, () => {
      // A press that never became a drag is the way in. Nothing else on the shrunk
      // preview is clickable, so this is the only gesture that has to be shared.
      if (!dragging) expandPreview()
    })
  }, [aspect, bounds, expandPreview, layout, startInteraction])

  const startResize = useCallback((edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || !layout || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const start = layout
    const west = edge.includes('w')
    const north = edge.includes('n')
    // Which axes this handle is allowed to read. A corner reads both and picks; a
    // side reads only its own, so dragging the left edge straight down does nothing
    // rather than quietly resizing off the axis the hand is not on.
    const horizontal = west || edge.includes('e')
    const vertical = north || edge.includes('s')
    startInteraction(RESIZE_CURSORS[edge], (move) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      // Both axes propose a width; the one the pointer moved further along wins, so a
      // mostly-vertical drag still resizes an aspect-locked box the way it looks like it should.
      const fromWidth = start.width + (west ? -dx : dx)
      const fromHeight = (start.height + (north ? -dy : dy)) * aspect
      const width = !vertical
        ? fromWidth
        : !horizontal
          ? fromHeight
          : Math.abs(fromWidth - start.width) >= Math.abs(fromHeight - start.width)
            ? fromWidth
            : fromHeight
      const fitted = clampIosSimulatorPipLayout({
        left: start.left,
        top: start.top,
        width,
        height: width / aspect,
      }, bounds, aspect)
      setLayout(clampIosSimulatorPipLayout({
        ...fitted,
        left: west ? start.left + start.width - fitted.width : start.left,
        top: north ? start.top + start.height - fitted.height : start.top,
      }, bounds, aspect))
    })
  }, [aspect, bounds, layout, startInteraction])

  // Hoisted so the shrunk box's rect is read where `layout` is still known to exist.
  const boxStyle: React.CSSProperties | undefined = layout
    ? { left: layout.left, top: layout.top, width: layout.width, height: layout.height, zIndex: 40 }
    : undefined

  return (
    <AnimatePresence>
      {/*
        ONE element for both sizes, deliberately — shrunk and expanded are the same
        device moved and resized, not two views of it.
        Splitting them into two branches (or two keys) made React unmount the whole
        panel on every expand and shrink, and the panel is the owner of a native
        media pipeline: a remount re-ran the `simctl` round trips, refetched the
        chrome artwork, built a fresh `<canvas>`, and so tore the frame stream down
        and renegotiated it with the helper — seconds of grey glass for what is
        visually a box changing size. Main can hand a running stream from one
        subscriber to the next, but only if their lifetimes OVERLAP, and the new
        panel could not subscribe until it had finished booting itself.
        So: same key, same tree position, same `IosSimulatorPanel` instance. The
        canvas element survives, `IosSimulatorStage`'s stream effect never re-fires,
        and expanding costs a re-render.
      */}
      {shouldShow && sessionId && (expanded || layout) && (
        <motion.div
          key={`device-preview:${sessionId}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          {...(expanded
            ? {
              'data-device-preview-overlay': '',
              role: 'dialog',
              'aria-modal': true,
              'aria-labelledby': 'expanded-device-preview-title',
            }
            : {
              'data-device-pip': '',
              'aria-label': t('chat.devicePreview.label'),
            })}
          // The shrunk preview's `z-40` is load-bearing, not decoration. The main area
          // wrapper in `App.tsx` is `relative z-20`, and a positive z-index paints in a
          // LATER step than a `fixed` element with `z-index: auto` — DOM order does not
          // enter into it. So without this the preview renders behind that wrapper: seen
          // through its `bg-card`, which liquid glass makes 72% opaque, and unable to
          // receive a single pointer event because the wrapper is on top of the drag
          // handle. Below the 50/51 the expanded overlay and the floating chat panel use.
          //
          // Shrunk it has no card of its own: no border, no surface, no radius. The
          // device's body is the only edge there should be, so the shadow follows its
          // silhouette rather than a rectangle drawn around it.
          className={cn(
            'fixed',
            expanded
              ? 'overflow-hidden border border-border bg-background shadow-2xl'
              : 'group/device-pip [filter:drop-shadow(0_10px_24px_rgb(0_0_0/0.45))]',
          )}
          style={expanded ? EXPANDED_BOX : boxStyle}
        >
          {expanded && (
            <h2 id="expanded-device-preview-title" className="sr-only">
              {t('chat.devicePreview.expandedLabel')}
            </h2>
          )}
          {/* Shrunk, look but do not touch: the whole surface belongs to the gesture
              below, and the device becomes operable only once it is expanded. Both
              states render the SAME element in the SAME slot — a className swap, so
              the panel underneath keeps its identity. */}
          <div className={cn('h-full', !expanded && 'pointer-events-none')}>
            <IosSimulatorPanel sessionId={sessionId} variant={expanded ? 'overlay' : 'preview'} />
          </div>
          {!expanded && (
            <div
              data-device-pip-drag-handle=""
              role="button"
              tabIndex={0}
              aria-label={t('chat.devicePreview.expand')}
              className="absolute inset-0 cursor-grab rounded-xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
              onPointerDown={onPreviewPointerDown}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                expandPreview()
              }}
            />
          )}
          {/* Dismissing the preview had no control of its own while it was shrunk —
              the eye lived only in the expanded overlay, so getting rid of a phone
              lying on the chat meant opening it first.

              It sits in the box's top-right corner, which for a device this is the
              empty triangle outside the body's ~55px corner arc: over the preview's
              own rect, but not over anything drawn. Revealed on hover, like the
              browser preview's. It covers the `ne` corner handle while it is up,
              which is why the top and right EDGES matter — resizing from that end of
              the box stays possible with the actions showing. */}
          {!expanded && (
            <div
              data-device-pip-actions=""
              className="pointer-events-none absolute right-0 top-0 z-40 flex items-center rounded-md bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/device-pip:pointer-events-auto group-hover/device-pip:opacity-100 group-focus-within/device-pip:pointer-events-auto group-focus-within/device-pip:opacity-100"
            >
              <IconButton
                aria-label={t('chat.devicePreview.hide')}
                tooltip={t('chat.devicePreview.hide')}
                tooltipSide="bottom"
                size="xs"
                variant="ghost"
                onClick={hidePreview}
              >
                <EyeOff />
              </IconButton>
            </div>
          )}
          {/* Corners over edges: the two overlap at every corner of the box, and the
              corner is the one that reads both axes. */}
          {!expanded && RESIZE_HANDLES.map(({ edge, className }) => (
            <div
              key={edge}
              data-device-pip-resize={edge}
              className={cn(
                'absolute',
                edge.length === 2 ? 'z-30' : 'z-20',
                className,
              )}
              onPointerDown={(event) => startResize(edge, event)}
            />
          ))}
          {/* Expanding is how the device becomes operable, so the toolbar comes with it.
              These two stay in the corner: with the header gone that space is free, and
              the header is what they used to collide with. */}
          {expanded && (
            <div
              data-device-preview-actions=""
              className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md bg-background/70 p-0.5 shadow-sm backdrop-blur-sm"
            >
              <IconButton
                aria-label={t('chat.devicePreview.shrink')}
                tooltip={t('chat.devicePreview.shrink')}
                tooltipSide="bottom"
                size="sm"
                variant="ghost"
                onClick={shrinkPreview}
              >
                <Minimize2 />
              </IconButton>
              <IconButton
                aria-label={t('chat.devicePreview.hide')}
                tooltip={t('chat.devicePreview.hide')}
                tooltipSide="bottom"
                size="sm"
                variant="ghost"
                onClick={hidePreview}
              >
                <EyeOff />
              </IconButton>
            </div>
          )}
        </motion.div>
      )}
      {expanded && OVERLAY_BACKDROP_PANES.map((pane) => (
        <motion.div
          key={`device-overlay-backdrop:${pane.key}`}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed bg-background/80 backdrop-blur-sm"
          style={{ ...pane.style, zIndex: 50 }}
        />
      ))}
    </AnimatePresence>
  )
}
