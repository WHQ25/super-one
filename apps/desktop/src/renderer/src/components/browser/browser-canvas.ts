/**
 * The canvas colour painted **behind** a browser guest page.
 *
 * Chromium normally paints the page canvas white, or #121212 when the document's
 * *used* colour-scheme is dark. Blink skips that entirely once the base background
 * is transparent — which is exactly what the glass window makes it — so a page that
 * paints no background of its own bleeds the app's vibrancy through. Electron 43
 * exposes no per-`WebContents` background colour, so the host layer re-derives
 * Chromium's rule here and paints it on the element under the `<webview>`.
 *
 * Only the new-tab page keeps the glass; every loaded page gets a browser canvas.
 */

/** Chromium's light canvas. */
export const BROWSER_LIGHT_CANVAS = 'white'
/** Chromium's dark canvas (the `Canvas` system colour under a dark colour-scheme). */
export const BROWSER_DARK_CANVAS = '#121212'

/**
 * Reads the guest's declared colour-scheme and its media preference in one round
 * trip. Evaluated in the guest, so it must stay a single expression.
 */
export const BROWSER_CANVAS_PROBE =
  "[getComputedStyle(document.documentElement).colorScheme, matchMedia('(prefers-color-scheme: dark)').matches]"

/** `[declared colour-scheme, prefers-color-scheme: dark]` — the probe's result shape. */
export type BrowserCanvasProbe = [declared: string, prefersDark: boolean]

export function isBrowserCanvasProbe(value: unknown): value is BrowserCanvasProbe {
  return Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'boolean'
}

/**
 * Resolves a declared `color-scheme` against the media preference the way CSS does:
 * `dark` wins when the page allows it and either the preference asks for dark or the
 * page offers no light alternative (`only dark`).
 */
export function browserCanvasColor(probe: BrowserCanvasProbe | null): string {
  if (!probe) return BROWSER_LIGHT_CANVAS
  const [declared, prefersDark] = probe
  const schemes = declared.toLowerCase().split(/\s+/).filter(Boolean)
  if (!schemes.includes('dark')) return BROWSER_LIGHT_CANVAS
  return prefersDark || !schemes.includes('light') ? BROWSER_DARK_CANVAS : BROWSER_LIGHT_CANVAS
}

/** Decodes a capture's data URL so it can be composited on a 2D canvas. */
export function decodeCaptureImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode browser capture'))
    image.src = dataUrl
  })
}

/**
 * `capturePage` grabs the guest alone, not the canvas colour painted under it, so a
 * page with no background of its own is captured with transparent pixels — a
 * screenshot no other browser would produce. Composite the capture over its canvas
 * so what is delivered matches what is on screen.
 *
 * Falls back to the raw capture whenever compositing is unavailable (no 2D context)
 * or fails: a slightly transparent screenshot beats no screenshot.
 */
export async function flattenBrowserCapture(
  image: Electron.NativeImage,
  canvasColor: string,
): Promise<string> {
  const dataUrl = image.toDataURL()
  try {
    const { width, height } = image.getSize()
    if (width <= 0 || height <= 0) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    const decoded = await decodeCaptureImage(dataUrl)
    context.fillStyle = canvasColor
    context.fillRect(0, 0, width, height)
    context.drawImage(decoded, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } catch {
    return dataUrl
  }
}
