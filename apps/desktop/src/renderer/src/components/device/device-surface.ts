/**
 * The decoded picture of one DEVICE, owned OUTSIDE React.
 *
 * A `<canvas>`, the `VideoDecoder` feeding it, and the frame subscription behind
 * that are one indivisible resource, and their natural lifetime is the DEVICE's —
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
 * panel per device rather than one per view: the shell is replaced under it. On iOS
 * the canvas can hang inside Apple's device artwork, and the artwork shell and the
 * drawn fallback are different elements — so the artwork lookup simply answering swaps
 * the host out. That is an unmount and a mount inside one commit, which the grace
 * period below is what carries the picture across.
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
 * to cover. It IS what disposes a device the user dismissed.
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

/**
 * Keyed by DEVICE, not by the session or the panel showing it.
 *
 * That is what makes two devices in one chat session two independent pictures, and it
 * is also what retires a whole class of bug: a panel that switches device used to
 * renegotiate the stream around the canvas it already had, so the old device's last
 * bitmap stayed on screen — indefinitely, on a simulator that only repaints when
 * something happens — until the new one produced a frame. A different device is now a
 * different entry, so the new panel starts from nothing and says so.
 */
const surfaces = new Map<string, Surface>()

export interface DeviceSurfaceOptions {
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

function openStream(deviceId: string, surface: Surface): void {
  surface.renderer = new DeviceFrameRenderer(
    surface.canvas,
    () => {
      if (surface.hasFrame) return
      surface.hasFrame = true
      for (const watcher of surface.watchers) watcher(true)
    },
    (cause) => reportDeviceError(messageOf(cause)),
  )
  // Device-scoped in preload, so nothing else's frames can arrive here.
  surface.removeFrameListener = window.environment.onDeviceFrame(
    deviceId,
    (frame) => surface.renderer.push(frame),
  )
  window.environment.openDeviceStream(deviceId, {
    mode: preferredDevicePreviewMode(),
    quality: surface.quality,
  })
}

function closeStream(deviceId: string, surface: Surface): void {
  surface.removeFrameListener()
  window.environment.closeDeviceStream(deviceId)
  surface.renderer.close()
}

/**
 * Renegotiate the stream around the canvas that is already on screen.
 *
 * Only ever the same device at a new size: scale and frame rate are settled in
 * `stream.start`, so changing either means a new stream and a new decoder, and
 * holding the old resolution on screen until the first frame at the new one lands is
 * what keeps it from blanking. `hasFrame` therefore stays true.
 *
 * A device CHANGE never reaches here — it is a different key, and so a different
 * surface with its own blank canvas. That is deliberate: keeping the old picture
 * across a device switch is not continuity, it is showing the user the wrong phone.
 */
function renegotiate(deviceId: string, surface: Surface, quality: IosSimulatorPreviewQuality): void {
  closeStream(deviceId, surface)
  surface.quality = quality
  openStream(deviceId, surface)
}

function dispose(deviceId: string): void {
  const surface = surfaces.get(deviceId)
  if (!surface) return
  surfaces.delete(deviceId)
  if (surface.graceTimer) clearTimeout(surface.graceTimer)
  closeStream(deviceId, surface)
  surface.canvas.remove()
}

/**
 * Show this device inside `host`, building the surface if this is the first view to
 * ask for it and adopting the running one if it is not.
 *
 * The returned detach does NOT tear anything down: it starts the grace period, which
 * the next attach cancels. A view that unmounts because another one is taking over
 * therefore hands the picture across intact.
 */
export function attachDeviceSurface(
  deviceId: string,
  host: HTMLElement,
  options: DeviceSurfaceOptions,
  onFrameState: (hasFrame: boolean) => void,
  onCanvas: (canvas: HTMLCanvasElement | null) => void,
): () => void {
  let surface = surfaces.get(deviceId)
  if (!surface) {
    const canvas = document.createElement('canvas')
    surface = {
      canvas,
      // Replaced immediately by `openStream`; typed non-null so the rest of the
      // module never has to ask whether a surface has a renderer yet.
      renderer: null as unknown as DeviceFrameRenderer,
      removeFrameListener: () => {},
      hasFrame: false,
      quality: options.quality,
      hosts: [],
      watchers: new Set(),
      graceTimer: null,
    }
    surfaces.set(deviceId, surface)
    openStream(deviceId, surface)
  } else if (surface.quality.scale !== options.quality.scale
    || surface.quality.maxFrameRate !== options.quality.maxFrameRate) {
    renegotiate(deviceId, surface, options.quality)
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
      const current = surfaces.get(deviceId)
      if (current !== live || current.hosts.length > 0) return
      dispose(deviceId)
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
  for (const deviceId of [...surfaces.keys()]) dispose(deviceId)
}
