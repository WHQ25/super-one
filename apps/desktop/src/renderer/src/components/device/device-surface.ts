/**
 * The decoded picture of one session's device, owned OUTSIDE React.
 *
 * A `<canvas>`, the `VideoDecoder` feeding it, and the frame subscription behind
 * that are one indivisible resource, and their natural lifetime is the session's —
 * not any particular view's. Left inside a component they died with it, and the
 * cost of rebuilding them is not the round trip: the helper encodes with
 * `MaxKeyFrameIntervalDuration = 1`, so a fresh decoder waits up to a full second
 * for an I-frame before it can draw anything at all. That second is what "the
 * preview is reconnecting" actually looks like.
 *
 * So the canvas moves instead of being rebuilt. `appendChild` re-parents it into
 * whichever host is showing the device now; the bitmap already painted on it
 * survives the move, the decoder never notices, and the move costs nothing.
 * This works only because the renderer draws through a plain 2D context — a canvas
 * handed to `transferControlToOffscreen` is welded to its element and could not be
 * moved. Anything that pushes decoding into a worker has to revisit this file.
 *
 * What still moves the canvas, now that `DeviceHostLayer` keeps ONE permanent
 * panel per session rather than one per view: the shell is replaced under it. On iOS
 * the canvas can hang inside Apple's device artwork, and the artwork shell and the
 * drawn fallback are different elements — so a device change, or the artwork lookup
 * simply answering, swaps the host out. Both are an unmount and a mount inside one commit,
 * which the grace period below is what carries the picture across.
 *
 * The other reason this is not just a `useRef` in the component: scale and frame rate
 * are settled in `stream.start`, so changing either needs a new stream and a new
 * decoder around the SAME canvas. Renegotiating here is what keeps the old resolution
 * on screen until the first frame at the new one lands.
 */

import type { IosSimulatorPreviewQuality } from '@superone/shared/ios-simulator'
import { DeviceFrameRenderer, preferredDevicePreviewMode } from './device-video'
import { messageOf, reportDeviceError } from './device-report'

/**
 * How long the surface outlives the last view that was showing it.
 *
 * Long enough to carry a shell swap, which happens inside a single commit, and then
 * some. Generous on purpose — nothing depends on this firing promptly, because every
 * deliberate ending (detach, shut down, session release) tears the stream down from
 * main instead of waiting for it. What it is NOT sized for any more is a surface
 * handover: the host layer keeps one panel mounted across those, so there is no gap
 * to cover. It IS what disposes a session whose device the user dismissed.
 */
const HANDOVER_GRACE_MS = 5_000

const CANVAS_CLASS = 'max-h-full max-w-full select-none object-contain'

interface Surface {
  canvas: HTMLCanvasElement
  renderer: DeviceFrameRenderer
  removeFrameListener: () => void
  /** Sticky: once the device has drawn, moving its picture must not flash a spinner. */
  hasFrame: boolean
  /** What the open stream was negotiated with; a change means renegotiating it. */
  deviceId: string
  quality: IosSimulatorPreviewQuality
  /**
   * Every view that currently wants the picture, oldest first — the last one holds it.
   *
   * A stack rather than a single host because attaches can INTERLEAVE. Tracking only
   * "the current host" lost the picture whenever they did: the second host took the
   * canvas, the first one's effect had no reason to re-run when the second left, and
   * the picture stayed parked in an element that was no longer in the document.
   * Keeping the order means a host that leaves hands the canvas back to whoever is
   * still waiting underneath, rather than starting the grace countdown over a picture
   * somebody still wants.
   */
  hosts: { el: HTMLElement; framed: boolean }[]
  watchers: Set<(hasFrame: boolean) => void>
  graceTimer: ReturnType<typeof setTimeout> | null
}

const surfaces = new Map<string, Surface>()

export interface DeviceSurfaceOptions {
  deviceId: string
  quality: IosSimulatorPreviewQuality
  /**
   * Whether device artwork is framing the picture. With it the shell hands the
   * screen an exact rect to fill; without it the canvas has to keep its own
   * proportions, which is what sizes the drawn fallback shell around it. Only iOS
   * ever supplies artwork, so on Android this is always false.
   */
  framed: boolean
}

function applyCanvasSize(canvas: HTMLCanvasElement, framed: boolean): void {
  canvas.className = `${CANVAS_CLASS} ${framed ? 'h-full w-full' : 'h-full w-auto'}`
}

function openStream(sessionId: string, surface: Surface): void {
  surface.renderer = new DeviceFrameRenderer(
    surface.canvas,
    () => {
      if (surface.hasFrame) return
      surface.hasFrame = true
      for (const watcher of surface.watchers) watcher(true)
    },
    (cause) => reportDeviceError(messageOf(cause)),
  )
  // Session-scoped in preload, so nothing else's frames can arrive here.
  surface.removeFrameListener = window.environment.onDeviceFrame(
    sessionId,
    (frame) => surface.renderer.push(frame),
  )
  window.environment.openDeviceStream(sessionId, {
    mode: preferredDevicePreviewMode(),
    quality: surface.quality,
  })
}

function closeStream(sessionId: string, surface: Surface): void {
  surface.removeFrameListener()
  window.environment.closeDeviceStream(sessionId)
  surface.renderer.close()
}

/**
 * Renegotiate the stream around the canvas that is already on screen.
 *
 * Two different reasons land here and they want OPPOSITE things from the picture.
 *
 * A quality change is the same device at a new size: scale and frame rate are settled
 * in `stream.start`, so changing either means a new stream and a new decoder, and
 * holding the old resolution on screen until the first frame at the new one lands is
 * what keeps it from blanking. `hasFrame` stays true for that.
 *
 * A DEVICE change is not a new version of what is on screen — it is a different
 * phone. Keeping that picture is not continuity, it is showing the user the wrong
 * device, and on a simulator that only repaints when something happens it can sit
 * there indefinitely. So the picture is dropped and the panel goes back to waiting,
 * which is the honest reading: this device has not shown us anything yet.
 */
function renegotiate(sessionId: string, surface: Surface, options: DeviceSurfaceOptions): void {
  const switchedDevice = surface.deviceId !== options.deviceId
  closeStream(sessionId, surface)
  surface.deviceId = options.deviceId
  surface.quality = options.quality
  if (switchedDevice) discardPicture(surface)
  openStream(sessionId, surface)
}

/** Forget what is drawn, and tell everyone watching that there is nothing to see. */
function discardPicture(surface: Surface): void {
  surface.hasFrame = false
  // The canvas is reused rather than rebuilt — rebuilding it would cost a stream
  // restart — so the old bitmap has to be wiped by hand. A first frame at a new
  // size resizes the canvas and clears it anyway; this covers the two devices that
  // happen to encode at the same one.
  const context = surface.canvas.getContext('2d', { alpha: false })
  context?.clearRect(0, 0, surface.canvas.width, surface.canvas.height)
  for (const watcher of surface.watchers) watcher(false)
}

function dispose(sessionId: string): void {
  const surface = surfaces.get(sessionId)
  if (!surface) return
  surfaces.delete(sessionId)
  if (surface.graceTimer) clearTimeout(surface.graceTimer)
  closeStream(sessionId, surface)
  surface.canvas.remove()
}

/**
 * Show this session's device inside `host`, building the surface if this is the
 * first view to ask for it and adopting the running one if it is not.
 *
 * The returned detach does NOT tear anything down: it starts the grace period, which
 * the next attach cancels. A view that unmounts because another one is taking over
 * therefore hands the picture across intact.
 */
export function attachDeviceSurface(
  sessionId: string,
  host: HTMLElement,
  options: DeviceSurfaceOptions,
  onFrameState: (hasFrame: boolean) => void,
  onCanvas: (canvas: HTMLCanvasElement | null) => void,
): () => void {
  let surface = surfaces.get(sessionId)
  if (!surface) {
    const canvas = document.createElement('canvas')
    surface = {
      canvas,
      // Replaced immediately by `openStream`; typed non-null so the rest of the
      // module never has to ask whether a surface has a renderer yet.
      renderer: null as unknown as DeviceFrameRenderer,
      removeFrameListener: () => {},
      hasFrame: false,
      deviceId: options.deviceId,
      quality: options.quality,
      hosts: [],
      watchers: new Set(),
      graceTimer: null,
    }
    surfaces.set(sessionId, surface)
    openStream(sessionId, surface)
  } else if (surface.deviceId !== options.deviceId || surface.quality.scale !== options.quality.scale
    || surface.quality.maxFrameRate !== options.quality.maxFrameRate) {
    renegotiate(sessionId, surface, options)
  }

  const live = surface
  if (live.graceTimer) {
    clearTimeout(live.graceTimer)
    live.graceTimer = null
  }
  live.hosts = [...live.hosts.filter((entry) => entry.el !== host), { el: host, framed: options.framed }]
  hand(live, live.hosts[live.hosts.length - 1]!)
  live.watchers.add(onFrameState)
  onFrameState(live.hasFrame)
  onCanvas(live.canvas)

  return () => {
    live.watchers.delete(onFrameState)
    onCanvas(null)
    const held = live.hosts[live.hosts.length - 1]?.el === host
    live.hosts = live.hosts.filter((entry) => entry.el !== host)
    // Someone else is still showing the device, or still waiting to: give the canvas
    // straight back rather than counting down towards throwing it away.
    if (!held) return
    const next = live.hosts[live.hosts.length - 1]
    if (next) { hand(live, next); return }
    live.graceTimer = setTimeout(() => {
      const current = surfaces.get(sessionId)
      if (current !== live || current.hosts.length > 0) return
      dispose(sessionId)
    }, HANDOVER_GRACE_MS)
  }
}

/** Move the canvas into a host, sized the way that host frames it. */
function hand(surface: Surface, target: { el: HTMLElement; framed: boolean }): void {
  applyCanvasSize(surface.canvas, target.framed)
  // Moves it off whatever held it before, bitmap and all.
  target.el.appendChild(surface.canvas)
}

/**
 * Test seam. The registry outlives the React tree by design, which in a test file
 * means it also outlives the test — without this, the second case in a file adopts
 * the first one's surface and never builds a renderer at all.
 */
export function resetDeviceSurfaces(): void {
  for (const sessionId of [...surfaces.keys()]) dispose(sessionId)
}
