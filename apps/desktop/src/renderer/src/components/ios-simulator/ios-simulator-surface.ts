/**
 * The decoded picture of one session's simulator, owned OUTSIDE React.
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
 * whichever view is showing the device now; the bitmap already painted on it
 * survives the move, the decoder never notices, and the handover costs nothing.
 * This works only because the renderer draws through a plain 2D context — a canvas
 * handed to `transferControlToOffscreen` is welded to its element and could not be
 * moved. Anything that pushes decoding into a worker has to revisit this file.
 *
 * Registry rather than a React context because the whole point is to outlive the
 * tree: the dock panel and the floating preview are in different branches, and the
 * gap between one unmounting and the other mounting is exactly what this bridges.
 */

import type { IosSimulatorPreviewQuality } from '@superone/shared/ios-simulator'
import { IosSimulatorFrameRenderer, preferredIosSimulatorPreviewMode } from './ios-simulator-video'
import { messageOf, reportIosSimulatorError } from './ios-simulator-report'

/**
 * How long the surface outlives the last view that was showing it.
 *
 * Sized for the gap in a tab↔preview handover, which is not instant: the arriving
 * panel has to re-read the device list and rebind before it has anything to attach
 * to. Generous on purpose — nothing depends on this firing promptly, because every
 * deliberate ending (detach, shut down, session release) tears the stream down from
 * main instead of waiting for it.
 */
const HANDOVER_GRACE_MS = 5_000

const CANVAS_CLASS = 'max-h-full max-w-full select-none object-contain'

interface Surface {
  canvas: HTMLCanvasElement
  renderer: IosSimulatorFrameRenderer
  removeFrameListener: () => void
  /** Sticky: once the device has drawn, moving its picture must not flash a spinner. */
  hasFrame: boolean
  /** What the open stream was negotiated with; a change means renegotiating it. */
  udid: string
  quality: IosSimulatorPreviewQuality
  /**
   * Every view that currently wants the picture, oldest first — the last one holds it.
   *
   * A stack rather than a single host because the two views OVERLAP: the floating
   * preview animates out while the tab is already mounting, so for a moment both are
   * alive and both have asked. Whoever asked last gets the canvas, and when they
   * leave it goes back to whoever is still waiting underneath rather than to the
   * grace timer. Tracking only "the current host" lost that: the tab took the canvas,
   * the preview's effect had no reason to re-run when the tab closed, and the picture
   * stayed parked in a host that was no longer in the document.
   */
  hosts: { el: HTMLElement; framed: boolean }[]
  watchers: Set<(hasFrame: boolean) => void>
  graceTimer: ReturnType<typeof setTimeout> | null
}

const surfaces = new Map<string, Surface>()

export interface IosSimulatorSurfaceOptions {
  udid: string
  quality: IosSimulatorPreviewQuality
  /**
   * Whether Apple's artwork is framing the picture. With it the shell hands the
   * screen an exact rect to fill; without it the canvas has to keep its own
   * proportions, which is what sizes the drawn fallback shell around it.
   */
  framed: boolean
}

function applyCanvasSize(canvas: HTMLCanvasElement, framed: boolean): void {
  canvas.className = `${CANVAS_CLASS} ${framed ? 'h-full w-full' : 'h-full w-auto'}`
}

function openStream(sessionId: string, surface: Surface): void {
  surface.renderer = new IosSimulatorFrameRenderer(
    surface.canvas,
    () => {
      if (surface.hasFrame) return
      surface.hasFrame = true
      for (const watcher of surface.watchers) watcher(true)
    },
    (cause) => reportIosSimulatorError(messageOf(cause)),
  )
  // Session-scoped in preload, so nothing else's frames can arrive here.
  surface.removeFrameListener = window.environment.onIosSimulatorFrame(
    sessionId,
    (frame) => surface.renderer.push(frame),
  )
  window.environment.openIosSimulatorStream(
    sessionId,
    preferredIosSimulatorPreviewMode(),
    surface.quality,
  )
}

function closeStream(sessionId: string, surface: Surface): void {
  surface.removeFrameListener()
  window.environment.closeIosSimulatorStream(sessionId)
  surface.renderer.close()
}

/**
 * Renegotiate without disturbing the picture.
 *
 * Scale and frame rate are settled in `stream.start`, so changing either one means
 * a new stream and a new decoder — but the SAME canvas, which is why the device
 * stays on screen at the old resolution until the first frame at the new one lands
 * rather than blanking. `hasFrame` deliberately stays true for that reason.
 */
function renegotiate(sessionId: string, surface: Surface, options: IosSimulatorSurfaceOptions): void {
  closeStream(sessionId, surface)
  surface.udid = options.udid
  surface.quality = options.quality
  openStream(sessionId, surface)
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
export function attachIosSimulatorSurface(
  sessionId: string,
  host: HTMLElement,
  options: IosSimulatorSurfaceOptions,
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
      renderer: null as unknown as IosSimulatorFrameRenderer,
      removeFrameListener: () => {},
      hasFrame: false,
      udid: options.udid,
      quality: options.quality,
      hosts: [],
      watchers: new Set(),
      graceTimer: null,
    }
    surfaces.set(sessionId, surface)
    openStream(sessionId, surface)
  } else if (surface.udid !== options.udid || surface.quality.scale !== options.quality.scale
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
export function resetIosSimulatorSurfaces(): void {
  for (const sessionId of [...surfaces.keys()]) dispose(sessionId)
}
