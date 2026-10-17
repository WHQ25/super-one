import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AsyncCoalescer } from '@superone/runtime/async-coalescer'
import type {
  IosSimulatorChrome,
  IosSimulatorChromeButton,
  IosSimulatorChromeCompositeBody,
  IosSimulatorChromeSliceBody,
  IosSimulatorChromeSlices,
  IosSimulatorFoldState,
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

export interface DeviceProfile {
  chromeIdentifier?: unknown
  framebufferMask?: unknown
  mainScreenWidth?: unknown
  mainScreenHeight?: unknown
  mainScreenScale?: unknown
}

export interface DeviceCapabilities {
  capabilities?: {
    displays?: Array<{
      displayType?: unknown
      screenID?: unknown
      nativeRotation?: unknown
      chromeIdentifier?: unknown
      framebufferMaskIdentifier?: unknown
      width?: unknown
      height?: unknown
      scale?: unknown
    }>
  }
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

function xcodeMajorVersion(version: string | null): number | null {
  const match = /^Xcode\s+(\d+)(?:\.|$)/.exec(version ?? '')
  return match ? Number(match[1]) : null
}

/** One integrated screen a device type declares, in points. */
export interface IntegratedDisplay {
  screenId: number | null
  chromeIdentifier: string
  framebufferMask: string
  screen: Size
  /** How the panel is mounted, in degrees, as `capabilities.plist` states it. */
  nativeRotation: number
}

/**
 * The integrated screens in `capabilities.plist`, the primary one first.
 *
 * Primary is the screen wearing the profile's own chrome. Most devices declare one;
 * a foldable declares its cover (primary) and its inner panel.
 */
export function integratedDisplays(
  capabilities: DeviceCapabilities | null,
  profile: DeviceProfile,
): IntegratedDisplay[] {
  const displays = (capabilities?.capabilities?.displays ?? []).flatMap((entry) => {
    if (entry.displayType !== 'integrated') return []
    const chromeIdentifier = entry.chromeIdentifier ?? profile.chromeIdentifier
    const framebufferMask = entry.framebufferMaskIdentifier ?? profile.framebufferMask
    const { width, height, scale, screenID, nativeRotation } = entry
    if (typeof chromeIdentifier !== 'string' || typeof framebufferMask !== 'string'
      || typeof width !== 'number' || !Number.isFinite(width) || width <= 0
      || typeof height !== 'number' || !Number.isFinite(height) || height <= 0
      || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return []
    return [{
      screenId: typeof screenID === 'number' && Number.isSafeInteger(screenID) && screenID > 0 ? screenID : null,
      chromeIdentifier,
      framebufferMask,
      screen: { width: width / scale, height: height / scale },
      nativeRotation: typeof nativeRotation === 'number' && [0, 90, 180, 270].includes(nativeRotation)
        ? nativeRotation : 0,
    }]
  })
  const primary = (display: IntegratedDisplay) => Number(display.chromeIdentifier === profile.chromeIdentifier)
  return displays.sort((a, b) => primary(b) - primary(a))
}

/** A foldable's two panels, by the screen ids the helper selects them with. */
export interface IosSimulatorFoldLayout {
  cover: { screenId: number; panelRotation: IosSimulatorFoldState['panelRotation'] }
  inner: { screenId: number; panelRotation: IosSimulatorFoldState['panelRotation'] }
}

/**
 * Two integrated screens make a foldable: the primary is the cover, the other the inner
 * panel. `panelRotation` undoes the mount, so a panel mounted at 270 turns 90 clockwise.
 */
export function foldLayout(displays: IntegratedDisplay[]): IosSimulatorFoldLayout | null {
  const [cover, inner] = displays
  if (!cover?.screenId || !inner?.screenId) return null
  const upright = (display: IntegratedDisplay) =>
    ((360 - display.nativeRotation) % 360) as IosSimulatorFoldState['panelRotation']
  return {
    cover: { screenId: cover.screenId, panelRotation: upright(cover) },
    inner: { screenId: inner.screenId, panelRotation: upright(inner) },
  }
}

async function deviceDisplay(
  resources: string,
  profile: DeviceProfile,
  xcodeVersion: string | null,
  read: ChromeLoaderDeps['readPlist'],
  screenId: number | null = null,
): Promise<{ chromeIdentifier: string; framebufferMask: string; screen: Size }> {
  const legacyScale = profile.mainScreenScale === undefined ? 1 : profile.mainScreenScale
  const legacy = typeof profile.chromeIdentifier === 'string'
    && typeof profile.framebufferMask === 'string'
    && typeof profile.mainScreenWidth === 'number' && Number.isFinite(profile.mainScreenWidth) && profile.mainScreenWidth > 0
    && typeof profile.mainScreenHeight === 'number' && Number.isFinite(profile.mainScreenHeight) && profile.mainScreenHeight > 0
    && typeof legacyScale === 'number' && Number.isFinite(legacyScale) && legacyScale > 0
    ? {
        chromeIdentifier: profile.chromeIdentifier,
        framebufferMask: profile.framebufferMask,
        screen: {
          width: profile.mainScreenWidth / legacyScale,
          height: profile.mainScreenHeight / legacyScale,
        },
      }
    : null
  if ((xcodeMajorVersion(xcodeVersion) ?? 0) < 27 && legacy && screenId === null) return legacy

  // Xcode 27 moved display dimensions from profile.plist into capabilities.plist.
  // Keep the legacy path for older Xcode and for device types with old metadata.
  const capabilities = await read<DeviceCapabilities>(join(resources, 'capabilities.plist'))
    .catch(() => null)
  const displays = integratedDisplays(capabilities, profile)
  const display = screenId === null
    ? displays[0]
    : displays.find((entry) => entry.screenId === screenId)
  if (display) return display
  if (legacy && screenId === null) return legacy
  throw new Error(screenId === null
    ? `No usable integrated display metadata for ${resources}`
    : `No usable metadata for screen ${screenId} in ${resources}`)
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

const chromeAnchor = (anchor: unknown): IosSimulatorChromeButton['anchor'] =>
  anchor === 'right' || anchor === 'top' || anchor === 'bottom' ? anchor : 'left'

/**
 * Which way an anchor's edge runs. Button art normally lies along its edge, but the
 * Duo's inner chrome (phone14) is anchored in the portrait framebuffer while its art
 * is drawn for the opened, landscape device — a 63x16 volume button on the left edge.
 * Such art is turned a quarter, so every image the renderer gets runs with its edge.
 */
type EdgeRun = 'vertical' | 'horizontal'
const edgeRun = (anchor: IosSimulatorChromeButton['anchor']): EdgeRun =>
  anchor === 'left' || anchor === 'right' ? 'vertical' : 'horizontal'

/** Button art per image and edge direction, as `parseChromeButtons` looks it up. */
export const buttonArtKey = (image: string, run: EdgeRun) => `${image}|${run}`

export function parseChromeButtons(
  chrome: ChromeJson,
  images: Map<string, { size: Size; image: string; pressedImage?: string }>,
): IosSimulatorChromeButton[] {
  return (chrome.inputs ?? []).flatMap((input) => {
    if (input.type !== 'button' || typeof input.name !== 'string' || typeof input.image !== 'string') return []
    const anchor = chromeAnchor(input.anchor)
    const art = images.get(buttonArtKey(input.image, edgeRun(anchor)))
    if (!art) return []
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
  /**
   * Rasterises a PDF to PNG at the given pixel width, returning the PNG bytes. A
   * quarter turn rotates the result clockwise, so its width becomes the height.
   */
  rasterize(pdfPath: string, pixelWidth: number, outPath: string, quarterTurn?: boolean): Promise<Buffer>
  readPlist<T>(path: string): Promise<T>
  readFile(path: string): Promise<Buffer>
  ensureDir(path: string): Promise<void>
  /** Drops a rasterised intermediate once it has been read back as a data URL. */
  removeFile(path: string): Promise<void>
}

async function sipsRasterize(
  pdfPath: string,
  pixelWidth: number,
  outPath: string,
  quarterTurn = false,
): Promise<Buffer> {
  // sips applies its actions in order: resample at the PDF's own width, then turn.
  await run('/usr/bin/sips', [
    '-s', 'format', 'png', '--resampleWidth', String(Math.max(1, Math.round(pixelWidth))),
    ...(quarterTurn ? ['--rotate', '90'] : []),
    pdfPath, '--out', outPath,
  ])
  return readFile(outPath)
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`

const chromeKey = (deviceTypeIdentifier: string, screenId: number | null) =>
  screenId === null ? deviceTypeIdentifier : `${deviceTypeIdentifier}#${screenId}`

/** Same shape within 1%: the inner Duo composite is drawn at 626x890 for a 669x951 panel. */
const sameAspect = (a: Size, b: Size) =>
  Math.abs(a.width / a.height - b.width / b.height) <= 0.01 * (b.width / b.height)

export class IosSimulatorChromeLoader {
  // Artwork changes only when Xcode does, so the entry never expires on its own;
  // `invalidate` is there for the user who installs a new Xcode mid-session.
  private readonly artwork = new AsyncCoalescer<IosSimulatorChrome | null>(Infinity)
  private readonly layouts = new AsyncCoalescer<IosSimulatorFoldLayout | null>(Infinity)
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

  /**
   * Resolves to null whenever the artwork is unavailable; the panel falls back to CSS.
   * `screenId` picks one panel of a foldable, which wears its own chrome; null means
   * the device's primary screen.
   */
  load(
    deviceTypeIdentifier: string,
    deviceTypeBundlePath: string,
    xcodeVersion: string | null = null,
    screenId: number | null = null,
  ): Promise<IosSimulatorChrome | null> {
    // The catch lives inside the compute so an unreadable bundle caches its null the
    // same way a model with no artwork does — one failed `sips` run per Xcode, not
    // one per panel remount.
    return this.artwork.get(chromeKey(deviceTypeIdentifier, screenId), () => this.read(deviceTypeBundlePath, xcodeVersion, screenId)
      .catch((error: unknown) => {
        this.onError?.(deviceTypeIdentifier, error)
        return null
      }))
  }

  /** A foldable's panels, or null for a device with one integrated screen. */
  foldLayout(deviceTypeIdentifier: string, deviceTypeBundlePath: string): Promise<IosSimulatorFoldLayout | null> {
    return this.layouts.get(deviceTypeIdentifier, async () => {
      const resources = join(deviceTypeBundlePath, 'Contents', 'Resources')
      const [profile, capabilities] = await Promise.all([
        this.deps.readPlist<DeviceProfile>(join(resources, 'profile.plist')),
        this.deps.readPlist<DeviceCapabilities>(join(resources, 'capabilities.plist')),
      ])
      return foldLayout(integratedDisplays(capabilities, profile))
    }).catch(() => null)
  }

  /** Drops the memo, for a host that just gained or changed its Xcode install. */
  invalidate(deviceTypeIdentifier: string): void {
    this.artwork.invalidate(chromeKey(deviceTypeIdentifier, null))
    this.layouts.invalidate(deviceTypeIdentifier)
  }

  /** Reads and measures a PDF, or returns null if absent or unmeasurable. */
  private async pdf(
    directory: string,
    name: unknown,
  ): Promise<{ path: string; size: Size } | null> {
    if (typeof name !== 'string' || !isSafeChromeAssetName(name)) return null
    const path = join(directory, `${name}.pdf`)
    const pdf = await this.deps.readFile(path).catch(() => null)
    const size = pdf && parseMediaBox(pdf)
    return size ? { path, size } : null
  }

  /** Rasterises a measured PDF at its natural size into a data URL. */
  private async raster(pdf: { path: string; size: Size }, outName: string, quarterTurn = false): Promise<string> {
    const outPath = join(this.scratchDir, `${outName}.png`)
    // The PNG exists only to be read straight back as a data URL. Left on disk it
    // accumulates every slice and every button of every device type ever previewed.
    const png = await this.deps
      .rasterize(pdf.path, pdf.size.width * RASTER_SCALE, outPath, quarterTurn)
      .finally(() => this.deps.removeFile(outPath))
    return dataUrl(png)
  }

  /** A button image lying along an edge of `run`, turned a quarter if drawn across it. */
  private async art(
    directory: string,
    name: string,
    outName: string,
    run: EdgeRun,
  ): Promise<{ size: Size; image: string } | null> {
    const pdf = await this.pdf(directory, name)
    if (!pdf) return null
    const { width, height } = pdf.size
    const turn = (run === 'vertical') !== (height >= width)
    return {
      size: turn ? { width: height, height: width } : pdf.size,
      image: await this.raster(pdf, turn ? `${outName}-turned` : outName, turn),
    }
  }

  /**
   * The body artwork for a `screen` framed by `sizing`, and the geometry it is drawn in.
   *
   * The iPhone Duo's chromes (phone14, phone15) ship all eight slices as copies of
   * one 118x64 "unused" placeholder; only their composite is real artwork. Real
   * slices never share a size — the edges are 1-2pt strips between square-ish
   * corners in every chrome Xcode 27 ships — so eight equal sizes mean placeholder.
   * Stretching it drew an orange frame with letters bleeding through.
   *
   * The composite is drawn for one screen size, so its own box sets the geometry —
   * the screen is whatever `sizing` leaves inside it — and it is usable only while
   * that screen has the panel's shape. Everything the panel draws is a fraction of
   * this box, so a composite drawn at another scale (phone14's is 626x890 around a
   * 669x951 panel) lines up with the framebuffer, its mask and its buttons alike.
   */
  private async bodyArt(
    resources: string,
    bundleName: string,
    images: Record<string, unknown>,
    screen: Size,
    sizing: Parameters<typeof deviceRect>[1],
  ): Promise<{
    art: IosSimulatorChromeSliceBody | IosSimulatorChromeCompositeBody
    body: ReturnType<typeof deviceRect>
  }> {
    // Every edge, or none: a body missing one side would draw a hole rather than
    // degrade, and the CSS shell is a better answer than that.
    const slices = await Promise.all(SLICE_KEYS.map((key) => this.pdf(resources, images[key])))
    if (slices.some((slice) => slice === null)) {
      throw new Error(`chrome.json for ${bundleName} is missing nine-slice artwork`)
    }
    const [first, ...rest] = slices as NonNullable<(typeof slices)[number]>[]
    const placeholder = rest.every((slice) =>
      slice.size.width === first!.size.width && slice.size.height === first!.size.height)
    if (!placeholder) {
      const rasters = await Promise.all(slices.map((slice, index) =>
        this.raster(slice!, `${bundleName}-${SLICE_KEYS[index]}`)))
      return {
        art: {
          slices: Object.fromEntries(SLICE_KEYS.map((key, index) => [key, rasters[index]])) as unknown as IosSimulatorChromeSlices,
          // Corners are square by construction, and all four are the same size.
          corner: first!.size.width,
        },
        body: deviceRect(screen, sizing),
      }
    }

    const composite = await this.pdf(resources, images.composite)
    const drawnScreen = composite && {
      width: composite.size.width - sizing.leftWidth - sizing.rightWidth,
      height: composite.size.height - sizing.topHeight - sizing.bottomHeight,
    }
    if (!composite || !drawnScreen || drawnScreen.width <= 0 || drawnScreen.height <= 0
      || !sameAspect(drawnScreen, screen)) {
      throw new Error(`chrome.json for ${bundleName} has placeholder slices and no composite for this device`)
    }
    return {
      art: { composite: await this.raster(composite, `${bundleName}-composite`) },
      body: deviceRect(drawnScreen, sizing),
    }
  }

  private async read(
    bundlePath: string,
    xcodeVersion: string | null,
    screenId: number | null,
  ): Promise<IosSimulatorChrome | null> {
    const resources = join(bundlePath, 'Contents', 'Resources')
    const profile = await this.deps.readPlist<DeviceProfile>(join(resources, 'profile.plist'))
    const display = await deviceDisplay(resources, profile, xcodeVersion, this.deps.readPlist, screenId)

    const bundleName = chromeBundleName(display.chromeIdentifier)
    if (!bundleName) throw new Error(`Unusable chrome identifier ${display.chromeIdentifier}`)
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

    const { art, body } = await this.bodyArt(chromeResources, bundleName, images, display.screen, sizing)

    if (!isSafeChromeAssetName(display.framebufferMask)) {
      throw new Error(`Unusable framebuffer mask ${display.framebufferMask}`)
    }
    const maskPath = join(resources, `${display.framebufferMask}.pdf`)
    const maskOutPath = join(this.scratchDir, `${display.framebufferMask}-mask.png`)
    const maskPng = await this.deps
      .rasterize(maskPath, body.screen.width * RASTER_SCALE, maskOutPath)
      .finally(() => this.deps.removeFile(maskOutPath))

    // Every unique button at once. Serially this was three round trips of two `sips`
    // spawns each behind the slices, roughly doubling the wait before the device
    // body could be drawn.
    const buttonImages = new Map(
      (chrome.inputs ?? []).flatMap((input) => {
        if (typeof input.image !== 'string') return []
        const run = edgeRun(chromeAnchor(input.anchor))
        return [[buttonArtKey(input.image, run), { image: input.image, run }] as const]
      }),
    )
    const buttonArt = new Map<string, { size: Size; image: string; pressedImage?: string }>()
    await Promise.all([...buttonImages].map(async ([key, { image, run }]) => {
      const [normal, pressed] = await Promise.all([
        this.art(chromeResources, image, `${bundleName}-btn-${image}`, run),
        this.art(chromeResources, `${image}${PRESSED_SUFFIX}`, `${bundleName}-btn-${image}-dn`, run),
      ])
      if (!normal) return
      buttonArt.set(key, { ...normal, ...(pressed ? { pressedImage: pressed.image } : {}) })
    }))

    const rawPadding = images.devicePadding as Record<string, unknown> | undefined
    const buttons = parseChromeButtons(chrome, buttonArt)
    return {
      identifier: typeof chrome.identifier === 'string' ? chrome.identifier : display.chromeIdentifier,
      ...art,
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
