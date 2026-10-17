import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { unzipSync } from 'fflate'
import { ANDROID_PHONE_REFERENCE_MODEL, type DeviceModelScreenPick, type LoadedDeviceModel } from '@superone/shared/device'
import { selectedDeveloperDirectory } from './ios-simulator/simctl'
import { composeUsdzPreview } from './usdz-preview'

interface DeviceModelEntry {
  file: string
  /** Which screen is this model's when the scene carries two sizes side by side. */
  screen: DeviceModelScreenPick
  /**
   * Read from the selected Xcode's DeviceKit instead of the models directory: Xcode
   * installs it on every machine that can run the simulator, so nothing is copied.
   */
  xcode?: true
  /** A foldable body's baked clip that closes its hinge. */
  foldClip?: string
}

/**
 * Simulator models (`DeviceDescriptor.model`) with an exact Apple AR model.
 *
 * Only exact bodies: a same-size stand-in shows the wrong camera bump or port on
 * a device people know on sight. Apple ships Pro and Pro Max in one scene, so those
 * pick their screen by size.
 */
const CATALOG: Record<string, DeviceModelEntry> = {
  'iPhone 16': { file: 'iphone-16.usdz', screen: 'only' },
  'iPhone 16 Plus': { file: 'iphone-16-plus.usdz', screen: 'only' },
  'iPhone 16 Pro': { file: 'iphone-16-pro.usdz', screen: 'only' },
  'iPhone 16 Pro Max': { file: 'iphone-16-pro-max.usdz', screen: 'only' },
  'iPhone 16e': { file: 'iphone-16e.usdz', screen: 'only' },
  'iPhone 17': { file: 'iphone-17.usdz', screen: 'only' },
  'iPhone 17 Pro': { file: 'iphone-17-pro-and-pro-max.usdz', screen: 'smallest' },
  'iPhone 17 Pro Max': { file: 'iphone-17-pro-and-pro-max.usdz', screen: 'largest' },
  'iPhone 17e': { file: 'iphone-17e.usdz', screen: 'only' },
  'iPhone 18 Pro': { file: 'iphone-18-pro-and-pro-max.usdz', screen: 'smallest' },
  'iPhone 18 Pro Max': { file: 'iphone-18-pro-and-pro-max.usdz', screen: 'largest' },
  'iPhone Air': { file: 'iphone-air.usdz', screen: 'only' },
  // Skinned, with the hinge baked into one timeline. `book_close` folds both halves
  // symmetrically, so a half-open device reads as a book facing the camera.
  'iPhone Duo': { file: 'V68.usdz', screen: 'largest', xcode: true, foldClip: 'book_close' },
  'iPad A16': { file: 'ipad-a16-pink.usdz', screen: 'only' },
  'iPad Air 13 inch M3': { file: 'ipad-air-m3-blue-with-accessories.usdz', screen: 'only' },
  'iPad mini A17 Pro': { file: 'ipad-mini-a17-pro-purple.usdz', screen: 'only' },
  'iPad Pro 13 inch M5 12GB': { file: 'ipad-pro-m5-space-black.usdz', screen: 'only' },
}

const ANDROID_PHONE_REFERENCE_FILE = 'android-reference/pixel-10-pro-D008-esim.glb'

/**
 * Apple and Google reference models have no redistribution licence, so none ship with the app.
 * Development reads the gitignored `apps/desktop/.device-models`; a packaged build
 * looks in userData, where nothing puts them automatically.
 */
function modelsDir(): string {
  return is.dev ? join(app.getAppPath(), '.device-models') : join(app.getPath('userData'), 'device-models')
}

const XCODE_DEVICE_MODELS = join(
  '..', 'SharedFrameworks', 'DeviceKit.framework', 'Versions', 'A', 'PlugIns',
  'CoreDevicePopDeviceKitExtension.devicekitplugin', 'Contents', 'Resources',
)

async function entryPath(entry: DeviceModelEntry): Promise<string | null> {
  if (!entry.xcode) return join(modelsDir(), entry.file)
  if (process.platform !== 'darwin') return null
  const developer = await selectedDeveloperDirectory().catch(() => null)
  return developer ? join(developer, XCODE_DEVICE_MODELS, entry.file) : null
}

/**
 * Where a named clip sits in the stage's one baked animation.
 *
 * RealityKit exports keep every clip on a single timeline and describe the cuts as
 * timeline actions: `string animation = "<name>"` with its own `startTime` and
 * `duration`. Read rather than hard-coded, so a re-cut model in a later Xcode still
 * lines up.
 */
export function readFoldClip(usda: string, name: string): { start: number; duration: number } | null {
  for (const action of usda.split(/\bdef RealityKitAction\b/).slice(1)) {
    if (!action.includes(`string animation = ${JSON.stringify(name)}`)) continue
    const start = Number(/\bdouble startTime = ([\d.eE+-]+)/.exec(action)?.[1])
    const duration = Number(/\bdouble duration = ([\d.eE+-]+)/.exec(action)?.[1])
    return Number.isFinite(start) && Number.isFinite(duration) && duration > 0 ? { start, duration } : null
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The catalog models whose file is actually on disk. */
export async function listDeviceModels(): Promise<string[]> {
  const present = await Promise.all(Object.entries(CATALOG).map(async ([model, entry]) => {
    const path = await entryPath(entry)
    return path && await exists(path) ? model : null
  }))
  const models = present.filter((model): model is string => model !== null)
  if (await exists(join(modelsDir(), ANDROID_PHONE_REFERENCE_FILE))) models.push(ANDROID_PHONE_REFERENCE_MODEL)
  return models
}

/** The composed stage for one simulator model, or null when it has none on disk. */
export async function loadDeviceModel(model: string): Promise<LoadedDeviceModel | null> {
  if (model === ANDROID_PHONE_REFERENCE_MODEL) {
    const path = join(modelsDir(), ANDROID_PHONE_REFERENCE_FILE)
    if (!(await exists(path))) return null
    return { archive: new Uint8Array(await readFile(path)), format: 'glb', screen: 'only', screenMeshName: 'Display', flipScreenV: true }
  }
  const entry = Object.hasOwn(CATALOG, model) ? CATALOG[model] : undefined
  if (!entry) return null
  const path = await entryPath(entry)
  if (!path || !(await exists(path))) return null
  const { archive } = await composeUsdzPreview(new Uint8Array(await readFile(path)))
  if (!entry.foldClip) return { archive, format: 'usdz', screen: entry.screen }
  const stage = unzipSync(archive, { filter: (file) => file.name === 'preview.usda' })['preview.usda']
  const fold = stage && readFoldClip(new TextDecoder().decode(stage), entry.foldClip)
  if (!fold) throw new Error(`${model}: the ${entry.foldClip} clip is missing from ${entry.file}`)
  return { archive, format: 'usdz', screen: entry.screen, fold }
}
