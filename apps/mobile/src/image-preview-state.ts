/**
 * Pure state behind the fullscreen image viewer: which sources it accepts, how
 * a shared copy is named, and the pinch / pan / double-tap geometry. Kept free
 * of React Native so it runs under vitest.
 */

/** A picture the chat WebView asked to show fullscreen. */
export interface ImagePreviewTarget {
  /** The `<img src>` the transcript painted: a data URI or a public URL. */
  src: string
  /** Accessible name; usually the tool label or the attachment file name. */
  label?: string
  /** Desktop path when the picture came off the host's disk. */
  path?: string
}

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

/**
 * Where the picture sits on screen. `translate` is in screen points relative
 * to the viewport centre and is applied before `scale`, so a point `p` of the
 * fitted picture (also relative to its centre) lands at `translate + scale * p`.
 */
export interface ImageTransform {
  scale: number
  translate: Point
}

export const MIN_SCALE = 1
export const MAX_SCALE = 4
/** Zoom a double tap jumps to; comfortable for reading text in a screenshot. */
export const DOUBLE_TAP_SCALE = 2.5
/** Two taps closer together than this (ms) are one double tap. */
export const DOUBLE_TAP_MS = 300
/** A finger that travelled further than this (pt) was a drag, not a tap. */
export const TAP_SLOP = 12

export const IDENTITY_TRANSFORM: ImageTransform = { scale: 1, translate: { x: 0, y: 0 } }

/** Sources the viewer can show without another transfer — mirrors the chat-view check. */
export function isPreviewableImageSource(src: unknown): src is string {
  return typeof src === 'string' && /^(data:image\/|https?:\/\/)/i.test(src)
}

/** Split an image data URI into the pieces a file write needs; `null` for anything else. */
export function parseImageDataUri(src: string): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src)
  if (!match) return null
  return { mimeType: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, '') }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/avif': 'avif',
}

/**
 * The file name a shared copy carries. The desktop path wins, then the label
 * when it already looks like a file name, then a generic name with the right
 * extension so the share sheet still knows what it is holding.
 */
export function imagePreviewFileName(target: ImagePreviewTarget, mimeType: string): string {
  const fromPath = target.path?.split(/[\\/]/).pop()
  if (fromPath) return sanitizeFileName(fromPath)
  const extension = EXTENSION_BY_MIME[mimeType] ?? 'img'
  if (target.label && /\.[a-z0-9]{2,5}$/i.test(target.label)) return sanitizeFileName(target.label)
  return `image.${extension}`
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return cleaned || 'image'
}

/** The size the picture takes at scale 1: contained inside the viewport, aspect kept. */
export function fitImage(viewport: Size, image: Size): Size {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return viewport
  const ratio = Math.min(viewport.width / image.width, viewport.height / image.height)
  return { width: image.width * ratio, height: image.height * ratio }
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Keep the picture covering the viewport: once an edge would come inside the
 * screen, the translation stops there. A picture smaller than the viewport on
 * an axis stays centred on that axis.
 */
export function clampTranslate(translate: Point, scale: number, viewport: Size, fitted: Size): Point {
  const maxX = Math.max(0, (fitted.width * scale - viewport.width) / 2)
  const maxY = Math.max(0, (fitted.height * scale - viewport.height) / 2)
  // `|| 0` folds the -0 that `Math.max(-0, …)` produces into a plain 0.
  return {
    x: Math.min(maxX, Math.max(-maxX, translate.x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, translate.y)) || 0,
  }
}

/**
 * Zoom around a focal point so the picture under the fingers stays under them.
 * `focal` points are relative to the viewport centre. The result is not clamped:
 * a pinch may overshoot and `settleTransform` springs it back on release.
 */
export function pinchTransform(
  start: ImageTransform & { focal: Point; distance: number },
  current: { focal: Point; distance: number },
): ImageTransform {
  const ratio = start.distance > 0 ? current.distance / start.distance : 1
  // Allow a little overshoot past the limits so the gesture feels elastic.
  const scale = Math.min(MAX_SCALE * 1.5, Math.max(MIN_SCALE * 0.7, start.scale * ratio))
  const factor = scale / start.scale
  return {
    scale,
    translate: {
      x: current.focal.x - (start.focal.x - start.translate.x) * factor,
      y: current.focal.y - (start.focal.y - start.translate.y) * factor,
    },
  }
}

/** Pan by a finger delta; only meaningful while zoomed in. */
export function panTransform(current: ImageTransform, delta: Point): ImageTransform {
  return { scale: current.scale, translate: { x: current.translate.x + delta.x, y: current.translate.y + delta.y } }
}

/**
 * A double tap toggles between fitted and `DOUBLE_TAP_SCALE` centred on the
 * tap, so the spot the user pointed at is what grows.
 */
export function doubleTapTransform(current: ImageTransform, tap: Point, viewport: Size, fitted: Size): ImageTransform {
  if (current.scale > MIN_SCALE) return IDENTITY_TRANSFORM
  const scale = DOUBLE_TAP_SCALE
  // The tapped picture point p = (tap - translate) / scale must stay under the tap.
  const p = { x: (tap.x - current.translate.x) / current.scale, y: (tap.y - current.translate.y) / current.scale }
  const translate = { x: tap.x - scale * p.x, y: tap.y - scale * p.y }
  return { scale, translate: clampTranslate(translate, scale, viewport, fitted) }
}

/**
 * Where a released gesture comes to rest: scale back inside its limits, a
 * fitted picture recentred, a zoomed one kept covering the viewport.
 */
export function settleTransform(current: ImageTransform, viewport: Size, fitted: Size): ImageTransform {
  const scale = clampScale(current.scale)
  if (scale <= MIN_SCALE) return IDENTITY_TRANSFORM
  // Rescaling around the centre keeps the translation proportional to the overshoot.
  const factor = scale / current.scale
  const translate = { x: current.translate.x * factor, y: current.translate.y * factor }
  return { scale, translate: clampTranslate(translate, scale, viewport, fitted) }
}

/** Straight-line distance between two touches. */
export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Midpoint of two touches. */
export function touchMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
