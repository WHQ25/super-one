import { remarkImageDestinations } from './presenters/markdown-media'

/**
 * A markdown image destination that names a file on the desktop (or the
 * remote node behind it) rather than bytes the WebView can show. The agent
 * writes `![…](out/a.png)` or `![…](/abs/a.png)` for a file the phone has
 * never seen; `NativeImage` turns this back into a path and asks the host.
 *
 * This is the phone's media transport in the shared pipeline
 * (`presenters/markdown-media`), the counterpart of the desktop's
 * `local-file:` — see there for why a path needs a scheme at all.
 */
export const HOST_IMAGE_PROTOCOL = 'host-file'

const HOST_IMAGE_PREFIX = `${HOST_IMAGE_PROTOCOL}:`

/** Destinations the WebView can display by itself; anything else is a host path. */
const DISPLAYABLE_SRC_RE = /^(?:https?:\/\/|data:|blob:)/i

/**
 * The path is percent-encoded as one opaque component so that spaces, Unicode,
 * `#`, `?` and a literal `%` in a file name survive URL parsing verbatim.
 */
export function encodeHostImageSrc(path: string): string {
  return `${HOST_IMAGE_PREFIX}${encodeURIComponent(path)}`
}

/** The desktop path behind a `host-file:` src, or null for any other src. */
export function decodeHostImageSrc(src: unknown): string | null {
  if (typeof src !== 'string' || !src.startsWith(HOST_IMAGE_PREFIX)) return null
  try {
    const path = decodeURIComponent(src.slice(HOST_IMAGE_PREFIX.length))
    return path || null
  } catch {
    return null
  }
}

/**
 * Wrap host paths so they reach the `img` component intact. The desktop's
 * `remarkMediaPaths` resolves against the project here; the phone does not,
 * because it hands the path to the desktop, which resolves it.
 */
export const remarkHostImages = remarkImageDestinations((path) => (
  DISPLAYABLE_SRC_RE.test(path) ? path : encodeHostImageSrc(path)
))
