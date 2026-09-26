import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { DeviceModelScreenPick, LoadedDeviceModel } from '@superone/shared/device'
import { composeUsdzPreview } from './usdz-preview'

interface DeviceModelEntry {
  file: string
  /** Which screen is this model's when the scene carries two sizes side by side. */
  screen: DeviceModelScreenPick
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
  'iPad A16': { file: 'ipad-a16-pink.usdz', screen: 'only' },
  'iPad Air 13 inch M3': { file: 'ipad-air-m3-blue-with-accessories.usdz', screen: 'only' },
  'iPad mini A17 Pro': { file: 'ipad-mini-a17-pro-purple.usdz', screen: 'only' },
  'iPad Pro 13 inch M5 12GB': { file: 'ipad-pro-m5-space-black.usdz', screen: 'only' },
}

/**
 * Apple's models carry no redistribution licence, so none ship with the app.
 * Development reads the gitignored `apps/desktop/.device-models`; a packaged build
 * looks in userData, where nothing puts them yet.
 */
function modelsDir(): string {
  return is.dev ? join(app.getAppPath(), '.device-models') : join(app.getPath('userData'), 'device-models')
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
  const dir = modelsDir()
  const present = await Promise.all(
    Object.entries(CATALOG).map(async ([model, entry]) => (await exists(join(dir, entry.file)) ? model : null)),
  )
  return present.filter((model): model is string => model !== null)
}

/** The composed stage for one simulator model, or null when it has none on disk. */
export async function loadDeviceModel(model: string): Promise<LoadedDeviceModel | null> {
  const entry = Object.hasOwn(CATALOG, model) ? CATALOG[model] : undefined
  if (!entry) return null
  const path = join(modelsDir(), entry.file)
  if (!(await exists(path))) return null
  const { archive } = await composeUsdzPreview(new Uint8Array(await readFile(path)))
  return { archive, screen: entry.screen }
}
