import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeOff, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { parseDeviceId } from '@superone/shared/device'
import type { IosSimulatorChrome } from '@superone/shared/ios-simulator'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useDevicePipStore, type DevicePipDevice } from '@/stores/device-pip'
import { createDragCapture } from '@/lib/drag-capture'
import type { PipBounds, PipLayout } from '@/lib/pip-layout'
import { DeviceView } from './DeviceView'
import { DEVICE_EXPANDED_BOX } from './DeviceOverlaySurface'
import { useDevicePreview } from './use-device-preview'
import {
  clampDevicePipLayout,
  createDefaultDevicePipLayout,
  defaultDevicePipMaxHeight,
  devicePipAspect,
} from './device-pip-layout'

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
 * Apple's artwork for the bound device — read for its OUTLINE, not to draw with.
 *
 * The stage loads the same thing to render it; this second read is what tells the box
 * what shape to be. Loading it here rather than having the stage report upwards keeps
 * the layout decision in the component that owns the layout, and costs nothing: main
 * coalesces the lookup per device type.
 *
 * `null` covers all three of "still loading", "this model ships none" and "this is
 * not an iOS device at all", which want the same answer — the framebuffer's own
 * shape, which is what the bare-glass shell draws.
 */
function useIosSimulatorChrome(device: DevicePipDevice | null): IosSimulatorChrome | null {
  const [chrome, setChrome] = useState<IosSimulatorChrome | null>(null)
  // Only the simulator has a udid; a mirrored iPhone would be iOS too and have none.
  const udid = device?.provider === 'ios-sim' ? parseDeviceId(device.id)?.native ?? null : null
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
 * The chrome of the floating preview: where the box is, how it is grabbed, and the
 * buttons on it. Not the device — that is drawn by `DeviceHostLayer`, over the
 * hole this component measures out with `DeviceView`.
 *
 * That separation is what makes the preview free to appear and vanish. It used to
 * render `DevicePanel` itself, which meant the panel died with it: switching to
 * the Activity tab unmounted the only owner of the frame stream, and the tab's fresh
 * panel then spent half a second re-reading the device list before it could draw. Now
 * neither surface owns anything, so a switch is a change of coordinates.
 *
 * Shrunk, the box is the device and nothing else — no panel chrome, no controls, no
 * card behind it: a phone lying on the chat, which can be moved, resized and clicked
 * to open. Every control the panel has lives in the expanded overlay, where there is
 * room to hit them.
 */
export function DevicePictureInPicture() {
  const { t } = useTranslation()
  const { instanceId, shouldShow, expanded, showPip } = useDevicePreview()
  const device = useDevicePipStore((state) => state.device)
  const chrome = useIosSimulatorChrome(device)
  const aspect = devicePipAspect(device, chrome)

  const [bounds, setBounds] = useState<PipBounds | null>(null)
  const [layout, setLayout] = useState<PipLayout | null>(null)
  const [interacting, setInteracting] = useState(false)
  const interactionCleanupRef = useRef<(() => void) | null>(null)
  const aspectRef = useRef(aspect)

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
        ? clampDevicePipLayout(
          current,
          nextBounds,
          aspect,
          turned ? { maxHeight: defaultDevicePipMaxHeight(nextBounds) } : undefined,
        )
        : createDefaultDevicePipLayout(nextBounds, aspect))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(boundary)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showPip, instanceId, aspect])

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
      onEnd?.()
    }
    interactionCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }, [])

  const hidePreview = useCallback(() => {
    if (instanceId) useDevicePipStore.getState().hidePreview(instanceId)
  }, [instanceId])

  const expandPreview = useCallback(() => {
    if (instanceId) useDevicePipStore.getState().expandPreview(instanceId)
  }, [instanceId])

  const shrinkPreview = useCallback(() => {
    useDevicePipStore.getState().shrinkPreview()
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
      setLayout(clampDevicePipLayout({
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
      const fitted = clampDevicePipLayout({
        left: start.left,
        top: start.top,
        width,
        height: width / aspect,
      }, bounds, aspect)
      setLayout(clampDevicePipLayout({
        ...fitted,
        left: west ? start.left + start.width - fitted.width : start.left,
        top: north ? start.top + start.height - fitted.height : start.top,
      }, bounds, aspect))
    })
  }, [aspect, bounds, layout, startInteraction])

  // Hoisted so the shrunk box's rect is read where `layout` is still known to exist.
  const boxStyle: React.CSSProperties | undefined = layout
    ? { left: layout.left, top: layout.top, width: layout.width, height: layout.height }
    : undefined

  return (
    <AnimatePresence>
      {/*
        ONE element for both sizes, deliberately — shrunk and expanded are the same
        device moved and resized, not two views of it. The device survives either way
        now that the host layer owns it, but the SLOT still has to be continuous: two
        keys would unmount one `DeviceView` and mount another, and for the beat
        in between neither the pip nor the overlay slot would exist, leaving the host
        with nowhere to be.
      */}
      {shouldShow && instanceId && (expanded || layout) && (
        <motion.div
          key={`device-preview:${instanceId}`}
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
          // No surface of its own in either size. Expanded, the card behind the device
          // is painted by `DeviceOverlaySurface`, UNDER the host layer's device;
          // shrunk there is no card at all, and the device's own silhouette carries the
          // shadow. What is left here is a frame around a hole: the measured slot, the
          // gesture surface, and the buttons.
          className={cn('fixed', !expanded && 'group/device-pip')}
          style={expanded ? DEVICE_EXPANDED_BOX : boxStyle}
        >
          {expanded && (
            <h2 id="expanded-device-preview-title" className="sr-only">
              {t('chat.devicePreview.expandedLabel')}
            </h2>
          )}
          {/* The hole the device is drawn over. Shrunk, look but do not touch: the
              whole surface belongs to the gesture below, and the device becomes
              operable only once it is expanded — which the host layer enforces by
              refusing pointer events to a `pip` slot. */}
          <DeviceView
            instanceId={instanceId}
            mode={expanded ? 'overlay' : 'pip'}
            // While the box is being dragged or resized its rect changes every frame,
            // and the device has to travel with it rather than lag and catch up.
            trackBoundsContinuously={interacting}
          />
          {!expanded && (
            <div
              data-device-pip-drag-handle=""
              role="button"
              tabIndex={0}
              aria-label={t('chat.devicePreview.expand')}
              className="pointer-events-auto absolute inset-0 cursor-grab rounded-xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
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
                'pointer-events-auto absolute',
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
              className="pointer-events-auto absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md bg-background/70 p-0.5 shadow-sm backdrop-blur-sm"
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
    </AnimatePresence>
  )
}
