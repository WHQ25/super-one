/**
 * The one place that speaks iPhone Mirroring to the Computer Use helper.
 *
 * Everything above this file addresses a DEVICE; everything below it addresses a
 * window belonging to `com.apple.ScreenContinuity`. Keeping the seam here is what
 * stops window ids, PIDs and coordinate-space metadata from leaking into the surface
 * and the backend.
 *
 * It borrows the helper rather than starting one. That helper is a separately signed
 * .app precisely so the Accessibility and Screen Recording grants attach to a stable
 * identity, and a second process would need the user to grant it all over again —
 * which is the single largest cost in this whole integration and is already paid.
 */

import { getSharedHelperClient } from '../../computer-use/platform/macos-helper-client'
import log from '../../logger'

/**
 * The only bundle this provider ever asks the helper to capture.
 *
 * Passed on every call rather than held anywhere, because that is the shape of the
 * helper's own API: `grantedBundleIds` is a per-request argument, so naming
 * ScreenContinuity here neither widens nor consults Computer Use's app allowlist. The
 * two authorisations are genuinely separate questions — "may the agent drive this Mac
 * app" and "did the user pick this phone in the device panel" — and this one is
 * answered by the panel.
 */
const MIRROR_BUNDLE_ID = 'com.apple.ScreenContinuity'

/** One text run Vision recognized, in the capture's own pixel space. */
export interface MirrorText {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export interface MirrorSnapshot {
  /** PNG bytes, ready for a frame or a file. */
  png: Buffer
  /** Pixel size of the capture, which OCR boxes are expressed in. */
  width: number
  height: number
  /** The window this was taken from, needed to turn a point back into a screen point. */
  windowId: number
  /** Screen-point size of the window when captured. The helper re-checks it on input. */
  windowWidth: number
  windowHeight: number
  scale: number
}

export interface MirrorState {
  /** Whether macOS has the app at all — false below macOS 15. */
  installed: boolean
  running: boolean
  /**
   * Whether the window is showing the PHONE.
   *
   * False while macOS draws one of its own screens there — "iPhone in Use", paused,
   * locked, or the initial connect prompt. See `interstitial` for what it says.
   */
  live: boolean
  /**
   * macOS's own words for why the session is not usable, already in the user's
   * language. Empty when `live`.
   */
  interstitial: Array<{ role: string; text: string }>
  windowId?: number
  pid?: number
  bounds?: { x: number; y: number; width: number; height: number }
}

/** The reason to show the user, picked from what macOS put on the screen. */
export function interstitialReason(state: MirrorState): string | null {
  if (state.live) return null
  // Static text over button titles: the same screen reported 'Connect' once and an
  // empty title a minute later, while its label stayed put.
  const labels = state.interstitial.filter((node) => node.role === 'AXStaticText' && node.text)
  return labels.map((node) => node.text).join(' · ') || null
}

async function call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
  const response = await getSharedHelperClient().request(method, params, timeoutMs)
  if (!response.ok) {
    throw new Error(response.error?.message || `iPhone Mirroring helper call failed: ${method}`)
  }
  return response.result as T
}

export async function readMirrorState(): Promise<MirrorState> {
  return call<MirrorState>('mirror_state', {}, 8_000)
}

/**
 * Bring the app up. Returns the state immediately after asking, not after connecting —
 * pairing can need the user, and the caller polls.
 */
export async function launchMirrorApp(): Promise<MirrorState> {
  return call<MirrorState>('mirror_launch', {}, 15_000)
}

/**
 * One picture of the phone.
 *
 * Requires the window to be on screen: ScreenCaptureKit will not capture a minimized
 * window. It may be behind anything, which is what lets the panel show the phone while
 * Apple's own window sits out of the way.
 */
export async function captureMirror(windowId: number, maxWidth?: number): Promise<MirrorSnapshot> {
  const result = await call<{
    data: string
    width: number
    height: number
    coordinateSpace: {
      scale: number
      capturedBounds: { x: number; y: number; width: number; height: number }
    }
  }>('capture', {
    capture: 'window',
    windowId,
    grantedBundleIds: [MIRROR_BUNDLE_ID],
    ...(maxWidth ? { maxWidth } : {}),
  })
  return {
    png: Buffer.from(result.data, 'base64'),
    width: result.width,
    height: result.height,
    windowId,
    windowWidth: result.coordinateSpace.capturedBounds.width,
    windowHeight: result.coordinateSpace.capturedBounds.height,
    scale: result.coordinateSpace.scale,
  }
}

/**
 * Read the screen the only way this provider can.
 *
 * Runs over a capture the caller already has, so one picture serves both the preview
 * and the agent's reading of it. Two captures would cost twice and describe two
 * different moments.
 */
export async function recognizeMirrorText(
  snapshot: MirrorSnapshot,
  minConfidence = 0.3,
): Promise<MirrorText[]> {
  const result = await call<{ texts: MirrorText[] }>('ocr', {
    data: snapshot.png.toString('base64'),
    minConfidence,
  }, 30_000)
  return result.texts
}

/**
 * The metadata that turns a point in a capture into a point on the phone.
 *
 * The helper does the arithmetic, and while doing it re-reads the window's live
 * geometry and refuses if it has moved or resized since the capture. That check is the
 * reason coordinates are handed over in capture space rather than converted here: a
 * tap resolved against a stale window would land on whatever is there now.
 */
function coordinateSpace(snapshot: MirrorSnapshot): Record<string, unknown> {
  return {
    coordinateKind: 'window',
    coordinateWindowId: snapshot.windowId,
    coordinateWidth: snapshot.width,
    coordinateHeight: snapshot.height,
    coordinateScale: snapshot.scale,
    capturedWidth: snapshot.windowWidth,
    capturedHeight: snapshot.windowHeight,
    targetBundleId: MIRROR_BUNDLE_ID,
  }
}

export async function tapMirror(snapshot: MirrorSnapshot, x: number, y: number, count = 1): Promise<void> {
  await call('click', { x, y, count, ...coordinateSpace(snapshot) })
}

/**
 * A gesture, as the path it traces.
 *
 * A path rather than a start and an end because that is what the helper takes, and
 * because a swipe on a phone is not a straight line to iOS: momentum and direction
 * come out of the intermediate points, so collapsing them would turn every flick into
 * the same slow drag.
 */
export async function dragMirror(
  snapshot: MirrorSnapshot,
  path: ReadonlyArray<{ x: number; y: number }>,
): Promise<void> {
  if (path.length < 2) throw new Error('A drag needs at least two points.')
  await call('drag', {
    path: path.map((point) => [point.x, point.y]),
    ...coordinateSpace(snapshot),
  })
}

export async function scrollMirror(
  snapshot: MirrorSnapshot,
  at: { x: number; y: number },
  delta: { dx: number; dy: number },
): Promise<void> {
  await call('scroll', { x: at.x, y: at.y, dx: delta.dx, dy: delta.dy, ...coordinateSpace(snapshot) })
}

export async function typeMirrorText(snapshot: MirrorSnapshot, text: string): Promise<void> {
  await call('type_text', { text, ...coordinateSpace(snapshot) })
}

/**
 * Press a key on the phone.
 *
 * The keys that matter are the mirroring app's OWN shortcuts, not the phone's: Cmd+1
 * is Home, Cmd+2 is the app switcher, Cmd+3 is Spotlight. There is no hardware Back —
 * iOS has none — so nothing here pretends to offer one.
 */
export async function pressMirrorKey(snapshot: MirrorSnapshot, key: string): Promise<void> {
  await call('keypress', { key, ...coordinateSpace(snapshot) })
}

/** Best-effort, for teardown paths that must not throw. */
export async function quietly(work: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await work()
  } catch (cause) {
    log.warn(`[ios-mirror] ${what} failed`, cause)
  }
}
