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
  /** Physical pixels in the sampled row that are an unmixed primary or white. */
  matchedPixels: number
  sampledPixels: number
  centerPixels: number[][]
  /** Colour runs in the sampled row. Zero when the bitmap is too small to sample. */
  runCount: number
}

type CapturePixelData = Uint8Array | Uint8ClampedArray

const WHITE = 3

/** 0–2 are the dominant channel; 3 is white. Null is a blended pixel. */
function classifyProbePixel(data: CapturePixelData, offset: number): number | null {
  const channels = [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0]
  if (channels.every((value) => value >= 200)) return WHITE
  const ordered = channels
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
  return ordered[0]!.value >= 200 && ordered[1]!.value <= 55
    ? ordered[0]!.index
    : null
}

/**
 * Recognize the renderer-only four-colour ruler used while a PiP webview moves
 * from a scaled surface to 1:1 capture mode.
 *
 * A sharp frame keeps at least 90% of the sampled row unmixed, and those pixels
 * form one run per stripe. The runs repeat every four colours — whichever byte
 * layout the bitmap has — and, ignoring a truncated run at each end, differ in
 * length by at most one physical pixel. Fractional display scales and a zoomed
 * page both pass while each CSS stripe still covers at least one device pixel.
 * A bilinear upscale blends the stripes below the purity bar. A nearest upscale
 * of a coarser surface keeps them pure but makes the run lengths uneven, or
 * drops colours so the period breaks.
 */
export function analyzeBrowserCaptureProbe(
  data: CapturePixelData,
  width: number,
  height: number,
): CaptureProbeAnalysis {
  if (width < BROWSER_CAPTURE_PROBE_RECT.width || height < 1 || data.length < width * height * 4) {
    return { ready: false, matchedPixels: 0, sampledPixels: 0, centerPixels: [], runCount: 0 }
  }

  const row = Math.floor(height / 2)
  const rowOffset = row * width * 4
  const centerPixels = [0, 1, 2, 3].map((stripe) => {
    const x = Math.min(width - 1, Math.floor(((stripe + 0.5) * width) / BROWSER_CAPTURE_PROBE_RECT.width))
    return Array.from(data.slice(rowOffset + x * 4, rowOffset + x * 4 + 4))
  })

  let matchedPixels = 0
  const runs: { color: number; length: number }[] = []
  for (let x = 0; x < width; x += 1) {
    const color = classifyProbePixel(data, rowOffset + x * 4)
    if (color == null) continue
    matchedPixels += 1
    const last = runs[runs.length - 1]
    if (last && last.color === color) last.length += 1
    else runs.push({ color, length: 1 })
  }

  const periodic = runs.length >= 4
    && new Set(runs.slice(0, 4).map((run) => run.color)).size === 4
    && runs.every((run, index) => index < 4 || run.color === runs[index - 4]?.color)
  const interior = runs.slice(1, -1).map((run) => run.length)
  const uniform = interior.length >= 16
    && Math.max(...interior) - Math.min(...interior) <= 1

  return {
    ready: matchedPixels / width >= 0.9 && periodic && uniform,
    matchedPixels,
    sampledPixels: width,
    centerPixels,
    runCount: runs.length,
  }
}
