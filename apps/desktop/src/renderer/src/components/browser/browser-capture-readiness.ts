export const BROWSER_CAPTURE_PROBE_RECT = { x: 0, y: 0, width: 64, height: 16 } as const

export const INSTALL_BROWSER_CAPTURE_PROBE_SCRIPT = `(() => {
  const attribute = 'data-superone-capture-scale-probe';
  document.querySelectorAll('[' + attribute + ']').forEach((node) => node.remove());
  const probe = document.createElement('div');
  probe.setAttribute(attribute, '');
  probe.style.cssText = [
    'all:initial!important',
    'position:fixed!important',
    'left:0!important',
    'top:0!important',
    'width:64px!important',
    'height:16px!important',
    'z-index:2147483647!important',
    'pointer-events:none!important',
    'opacity:1!important',
    'transform:none!important',
    'filter:none!important',
    'background:repeating-linear-gradient(90deg,#f00 0 1px,#0f0 1px 2px,#00f 2px 3px,#fff 3px 4px)!important',
  ].join(';');
  document.documentElement.appendChild(probe);
  return true;
})()`

export const REMOVE_BROWSER_CAPTURE_PROBE_SCRIPT = `(() => new Promise((resolve) => {
  document.querySelectorAll('[data-superone-capture-scale-probe]').forEach((node) => node.remove());
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
}))()`

export interface CaptureProbeAnalysis {
  ready: boolean
  matchedPixels: number
  sampledPixels: number
  centerPixels: number[][]
}

type CapturePixelData = Uint8Array | Uint8ClampedArray

function primaryChannel(data: CapturePixelData, offset: number): number | null {
  const channels = [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0]
  const ordered = channels
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
  return ordered[0]!.value >= 200 && ordered[1]!.value <= 55
    ? ordered[0]!.index
    : null
}

/**
 * Recognize the renderer-only four-colour ruler used while a PiP webview moves
 * from a scaled surface to 1:1 capture mode. A sharp frame has one unmixed
 * primary (or white) for almost every physical pixel. A compositor-upscaled
 * frame contains blended edge colours and fails this check.
 *
 * The primary-channel order is learned from the bitmap so this remains valid
 * across native BGRA/RGBA byte layouts.
 */
export function analyzeBrowserCaptureProbe(
  data: CapturePixelData,
  width: number,
  height: number,
): CaptureProbeAnalysis {
  if (width < BROWSER_CAPTURE_PROBE_RECT.width || height < 1 || data.length < width * height * 4) {
    return { ready: false, matchedPixels: 0, sampledPixels: 0, centerPixels: [] }
  }

  const row = Math.floor(height / 2)
  const rowOffset = row * width * 4
  const centerPixels = [0, 1, 2, 3].map((stripe) => {
    const x = Math.min(width - 1, Math.floor(((stripe + 0.5) * width) / BROWSER_CAPTURE_PROBE_RECT.width))
    return Array.from(data.slice(rowOffset + x * 4, rowOffset + x * 4 + 4))
  })
  const centers = centerPixels.slice(0, 3).map((pixel) => primaryChannel(Uint8Array.from(pixel), 0))
  if (centers.some((channel) => channel == null) || new Set(centers).size !== 3) {
    return { ready: false, matchedPixels: 0, sampledPixels: width, centerPixels }
  }

  let matchedPixels = 0
  for (let x = 0; x < width; x += 1) {
    const offset = rowOffset + x * 4
    const stripe = Math.min(
      BROWSER_CAPTURE_PROBE_RECT.width - 1,
      Math.floor((x * BROWSER_CAPTURE_PROBE_RECT.width) / width),
    )
    const phase = stripe % 4
    if (phase === 3) {
      const white = (data[offset] ?? 0) >= 200
        && (data[offset + 1] ?? 0) >= 200
        && (data[offset + 2] ?? 0) >= 200
      if (white) matchedPixels += 1
    } else if (primaryChannel(data, offset) === centers[phase]) {
      matchedPixels += 1
    }
  }

  return {
    ready: matchedPixels / width >= 0.9,
    matchedPixels,
    sampledPixels: width,
    centerPixels,
  }
}
