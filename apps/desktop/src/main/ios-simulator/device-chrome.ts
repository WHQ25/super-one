import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AsyncCoalescer } from '../async-cache'
import type {
  IosSimulatorChrome,
  IosSimulatorChromeButton,
  IosSimulatorChromeSlices,
} from '@superone/shared/ios-simulator'

// Apple ships the real device artwork with Xcode: the body lives in a DeviceKit
// "chrome" bundle and the exact screen corner shape lives in the device type's
// framebuffer mask. We read both from the user's own install and never bundle
// them — they are Apple's assets, and this panel already requires Xcode.
const DEVICE_KIT_CHROME = '/Library/Developer/DeviceKit/Chrome'

/** Rendered at 2× so the artwork stays crisp on a retina panel without bloating IPC. */
const RASTER_SCALE = 2

/**
 * Apple's own suffix for a button's pressed artwork. Absent for some models, in
 * which case the button just does not darken.
 */
const PRESSED_SUFFIX = ' Dn'

const SLICE_KEYS = [
  'topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft', 'left',
] as const

interface ChromeInput {
  name?: unknown
  accessibilityTitle?: unknown
  type?: unknown
  image?: unknown
  anchor?: unknown
  offsets?: { normal?: { x?: unknown; y?: unknown }; rollover?: { x?: unknown; y?: unknown } }
}

interface ChromeJson {
  identifier?: unknown
  images?: Record<string, unknown>
  inputs?: ChromeInput[]
}

interface DeviceProfile {
  chromeIdentifier?: unknown
  framebufferMask?: unknown
  mainScreenWidth?: unknown
  mainScreenHeight?: unknown
  mainScreenScale?: unknown
}

interface Size {
  width: number
  height: number
}

/**
 * Whether a name read out of chrome.json or profile.plist may be joined onto a path.
 *
 * `chromeBundleName` already guards its own component and these did not, which left
 * two different standards for strings from the same source. It cannot be the same
 * alphanumeric test: Apple's asset names carry spaces ('Phone TL', 'Vol BTN'), so
 * this rules out traversal and separators rather than describing the whole alphabet.
 */
export function isSafeChromeAssetName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.length > 0 && !name.startsWith('.') && !/[\\/\u0000]/.test(name)
}

/** `com.apple.dt.devicekit.chrome.phone11` → `phone11`. */
export function chromeBundleName(chromeIdentifier: string): string | null {
  const suffix = chromeIdentifier.split('.').pop()
  // Guard the path join: this string comes from a plist on disk, not from us.
  return suffix && /^[A-Za-z0-9_-]+$/.test(suffix) ? suffix : null
}

/**
 * PDF page size in points — the artwork's natural coordinate system.
 *
 * Scans the whole file on purpose: Apple writes the page tree at the END of these
 * PDFs, so `/MediaBox` lands around byte 5600-7600. Reading only a prefix silently
 * returned null for every single device.
 */
export function parseMediaBox(pdf: Buffer): Size | null {
  const match = /\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/.exec(
    pdf.toString('latin1'),
  )
  if (!match) return null
  const [x0, y0, x1, y1] = match.slice(1, 5).map(Number)
  const width = x1! - x0!
  const height = y1! - y0!
  return width > 0 && height > 0 ? { width, height } : null
}

function positiveNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * The device's own rectangle: the screen plus the frame around it, taken from
 * `images.sizing`.
 *
 * This is per device, which the composite artwork is not — one composite is shipped
 * per chrome bundle and sized for a single model, so an iPhone Air drawn into the
 * iPhone 17 Pro Max composite came out with a 27pt bezel on one axis and 39pt on the
 * other. Verified against every composite-bearing chrome: screen plus `sizing`
 * reproduces the composite's own box to within a point.
 */
export function deviceRect(
  screen: Size,
  sizing: { leftWidth: number; rightWidth: number; topHeight: number; bottomHeight: number },
): { width: number; height: number; screen: { x: number; y: number; width: number; height: number } } {
  return {
    width: screen.width + sizing.leftWidth + sizing.rightWidth,
    height: screen.height + sizing.topHeight + sizing.bottomHeight,
    // Not centred: a chrome may frame its screen asymmetrically.
    screen: { x: sizing.leftWidth, y: sizing.topHeight, ...screen },
  }
}

// chrome.json names buttons the way the hardware does; our input channel has its
// own vocabulary. Anything unmapped still renders — an iPhone Action button is real
// enough to draw, and Simulator.app has no channel for it either.
const INPUT_BY_CHROME_NAME: Record<string, IosSimulatorChromeButton['input']> = {
  'power': 'lock',
  'lock': 'lock',
  'volume-up': 'volume-up',
  'volume-down': 'volume-down',
  'home': 'home',
  'side': 'side',
  'side-button': 'side',
}

/**
 * Apple stores each offset as an x/y pair whose meaning flips with the anchor: on a
 * side button, x is how far it pokes out and y is how far down the edge it sits; on
 * a top or bottom button they swap. Only the poke-out value differs between the
 * resting and hovered offsets, which is what makes that reading unambiguous.
 */
function readOffset(
  anchor: IosSimulatorChromeButton['anchor'],
  offset: { x?: unknown; y?: unknown } | undefined,
): { across: number; along: number } | null {
  if (typeof offset?.x !== 'number' || typeof offset.y !== 'number') return null
  const vertical = anchor === 'top' || anchor === 'bottom'
  // The sign only says which edge it was measured from, which the anchor already
  // tells us — except along the edge, where a negative value means "from the far
  // end" and has to survive.
  return vertical
    ? { across: Math.abs(offset.y), along: offset.x }
    : { across: Math.abs(offset.x), along: offset.y }
}

export function parseChromeButtons(
  chrome: ChromeJson,
  images: Map<string, { size: Size; image: string; pressedImage?: string }>,
): IosSimulatorChromeButton[] {
  return (chrome.inputs ?? []).flatMap((input) => {
    if (input.type !== 'button' || typeof input.name !== 'string' || typeof input.image !== 'string') return []
    const art = images.get(input.image)
    if (!art) return []
    const anchor = input.anchor === 'right' || input.anchor === 'top' || input.anchor === 'bottom'
      ? input.anchor
      : 'left'
    const offset = readOffset(anchor, input.offsets?.normal)
    if (!offset) return []
    const mapped = INPUT_BY_CHROME_NAME[input.name]
    return [{
      name: input.name,
      title: typeof input.accessibilityTitle === 'string' ? input.accessibilityTitle : input.name,
      anchor,
      offset,
      hoverOffset: readOffset(anchor, input.offsets?.rollover) ?? offset,
      width: art.size.width,
      height: art.size.height,
      image: art.image,
      ...(art.pressedImage ? { pressedImage: art.pressedImage } : {}),
      ...(mapped ? { input: mapped } : {}),
    }]
  })
}

/**
 * How much room the buttons need outside the body.
 *
 * `devicePadding` is Apple's own reservation, but it is not always enough: a phone
 * reserves 9pt while a hovered volume button reaches 13pt out, so the far end would
 * clip exactly when the user was aiming at it. The artwork is the authority — the
 * smallest `across` a button ever takes is its furthest reach.
 */
export function chromePadding(
  devicePadding: { top: number; left: number; bottom: number; right: number },
  buttons: IosSimulatorChromeButton[],
): { top: number; left: number; bottom: number; right: number } {
  const padding = { ...devicePadding }
  for (const button of buttons) {
    const vertical = button.anchor === 'top' || button.anchor === 'bottom'
    const size = vertical ? button.height : button.width
    const reach = size - Math.min(button.offset.across, button.hoverOffset.across)
    padding[button.anchor] = Math.max(padding[button.anchor], reach)
  }
  return padding
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, _stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()))
      else resolve()
    })
  })
}

async function readPlist<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    // plutil is the only reliable reader for the binary plists Apple ships, and
    // it is on every macOS install.
    execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()))
      else {
        try { resolve(JSON.parse(stdout) as T) } catch (cause) { reject(cause as Error) }
      }
    })
  })
}

export interface ChromeLoaderDeps {
  /** Rasterises a PDF to PNG at the given pixel width, returning the PNG bytes. */
  rasterize(pdfPath: string, pixelWidth: number, outPath: string): Promise<Buffer>
  readPlist<T>(path: string): Promise<T>
  readFile(path: string): Promise<Buffer>
  ensureDir(path: string): Promise<void>
  /** Drops a rasterised intermediate once it has been read back as a data URL. */
  removeFile(path: string): Promise<void>
}

async function sipsRasterize(pdfPath: string, pixelWidth: number, outPath: string): Promise<Buffer> {
  await run('/usr/bin/sips', [
    '-s', 'format', 'png', '--resampleWidth', String(Math.max(1, Math.round(pixelWidth))),
    pdfPath, '--out', outPath,
  ])
  return readFile(outPath)
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`

export class IosSimulatorChromeLoader {
  // Artwork changes only when Xcode does, so the entry never expires on its own;
  // `invalidate` is there for the user who installs a new Xcode mid-session.
  private readonly artwork = new AsyncCoalescer<IosSimulatorChrome | null>(Infinity)
  private readonly deps: ChromeLoaderDeps

  /** Reports why artwork could not be read; a silent null is impossible to debug. */
  onError: ((deviceTypeIdentifier: string, error: unknown) => void) | undefined

  constructor(private readonly scratchDir: string, deps?: Partial<ChromeLoaderDeps>) {
    this.deps = {
      rasterize: sipsRasterize,
      readPlist,
      readFile,
      ensureDir: async (path) => { await mkdir(path, { recursive: true }) },
      removeFile: async (path) => { await rm(path, { force: true }) },
      ...deps,
    }
  }

  /** Resolves to null whenever the artwork is unavailable; the panel falls back to CSS. */
  load(deviceTypeIdentifier: string, deviceTypeBundlePath: string): Promise<IosSimulatorChrome | null> {
    // The catch lives inside the compute so an unreadable bundle caches its null the
    // same way a model with no artwork does — one failed `sips` run per Xcode, not
    // one per panel remount.
    return this.artwork.get(deviceTypeIdentifier, () => this.read(deviceTypeBundlePath)
      .catch((error: unknown) => {
        this.onError?.(deviceTypeIdentifier, error)
        return null
      }))
  }

  /** Drops the memo, for a host that just gained or changed its Xcode install. */
  invalidate(deviceTypeIdentifier: string): void {
    this.artwork.invalidate(deviceTypeIdentifier)
  }

  /** Measures a PDF and rasterises it at its natural size, or returns null if absent. */
  private async art(
    directory: string,
    name: string,
    outName: string,
  ): Promise<{ size: Size; image: string } | null> {
    if (!isSafeChromeAssetName(name)) return null
    const path = join(directory, `${name}.pdf`)
    const pdf = await this.deps.readFile(path).catch(() => null)
    const size = pdf && parseMediaBox(pdf)
    if (!size) return null
    const outPath = join(this.scratchDir, `${outName}.png`)
    // The PNG exists only to be read straight back as a data URL. Left on disk it
    // accumulates every slice and every button of every device type ever previewed.
    const png = await this.deps
      .rasterize(path, size.width * RASTER_SCALE, outPath)
      .finally(() => this.deps.removeFile(outPath))
    return { size, image: dataUrl(png) }
  }

  private async read(bundlePath: string): Promise<IosSimulatorChrome | null> {
    const resources = join(bundlePath, 'Contents', 'Resources')
    const profile = await this.deps.readPlist<DeviceProfile>(join(resources, 'profile.plist'))
    if (
      typeof profile.chromeIdentifier !== 'string'
      || typeof profile.framebufferMask !== 'string'
      || typeof profile.mainScreenWidth !== 'number'
      || typeof profile.mainScreenHeight !== 'number'
    ) throw new Error(`profile.plist is missing chrome fields for ${bundlePath}`)
    const scale = typeof profile.mainScreenScale === 'number' ? profile.mainScreenScale : 1

    const bundleName = chromeBundleName(profile.chromeIdentifier)
    if (!bundleName) throw new Error(`Unusable chrome identifier ${profile.chromeIdentifier}`)
    const chromeResources = join(DEVICE_KIT_CHROME, `${bundleName}.devicechrome`, 'Contents', 'Resources')
    const chrome = JSON.parse(
      (await this.deps.readFile(join(chromeResources, 'chrome.json'))).toString('utf8'),
    ) as ChromeJson
    const images = chrome.images ?? {}
    const rawSizing = images.sizing as Record<string, unknown> | undefined
    const sizing = {
      leftWidth: positiveNumber(rawSizing?.leftWidth),
      rightWidth: positiveNumber(rawSizing?.rightWidth),
      topHeight: positiveNumber(rawSizing?.topHeight),
      bottomHeight: positiveNumber(rawSizing?.bottomHeight),
    }
    if (sizing.leftWidth <= 0 || sizing.topHeight <= 0) {
      throw new Error(`chrome.json for ${bundleName} has no usable sizing`)
    }

    await this.deps.ensureDir(this.scratchDir)

    // Every edge, or none: a body missing one side would draw a hole rather than
    // degrade, and the CSS shell is a better answer than that.
    const sliceArt = await Promise.all(SLICE_KEYS.map(async (key) => {
      const name = images[key]
      if (typeof name !== 'string') return null
      const art = await this.art(chromeResources, name, `${bundleName}-${key}`)
      return art ? ([key, art] as const) : null
    }))
    if (sliceArt.some((entry) => entry === null)) {
      throw new Error(`chrome.json for ${bundleName} is missing nine-slice artwork`)
    }
    const slices = Object.fromEntries(
      sliceArt.map((entry) => [entry![0], entry![1].image] as const),
    ) as unknown as IosSimulatorChromeSlices
    // Corners are square by construction, and all four are the same size.
    const corner = sliceArt.find((entry) => entry![0] === 'topLeft')![1].size.width

    const screen = { width: profile.mainScreenWidth / scale, height: profile.mainScreenHeight / scale }
    const body = deviceRect(screen, sizing)

    if (!isSafeChromeAssetName(profile.framebufferMask)) {
      throw new Error(`Unusable framebuffer mask ${profile.framebufferMask}`)
    }
    const maskPath = join(resources, `${profile.framebufferMask}.pdf`)
    const maskOutPath = join(this.scratchDir, `${profile.framebufferMask}-mask.png`)
    const maskPng = await this.deps
      .rasterize(maskPath, screen.width * RASTER_SCALE, maskOutPath)
      .finally(() => this.deps.removeFile(maskOutPath))

    // Every unique button at once. Serially this was three round trips of two `sips`
    // spawns each behind the slices, roughly doubling the wait before the device
    // body could be drawn.
    const buttonImages = new Set(
      (chrome.inputs ?? [])
        .map((input) => input.image)
        .filter((image): image is string => typeof image === 'string'),
    )
    const buttonArt = new Map<string, { size: Size; image: string; pressedImage?: string }>()
    await Promise.all([...buttonImages].map(async (image) => {
      const [normal, pressed] = await Promise.all([
        this.art(chromeResources, image, `${bundleName}-btn-${image}`),
        this.art(chromeResources, `${image}${PRESSED_SUFFIX}`, `${bundleName}-btn-${image}-dn`),
      ])
      if (!normal) return
      buttonArt.set(image, { ...normal, ...(pressed ? { pressedImage: pressed.image } : {}) })
    }))

    const rawPadding = images.devicePadding as Record<string, unknown> | undefined
    const buttons = parseChromeButtons(chrome, buttonArt)
    return {
      identifier: typeof chrome.identifier === 'string' ? chrome.identifier : profile.chromeIdentifier,
      slices,
      corner,
      screenMask: dataUrl(maskPng),
      width: body.width,
      height: body.height,
      padding: chromePadding({
        top: positiveNumber(rawPadding?.top),
        left: positiveNumber(rawPadding?.left),
        bottom: positiveNumber(rawPadding?.bottom),
        right: positiveNumber(rawPadding?.right),
      }, buttons),
      screen: body.screen,
      buttons,
    }
  }
}
