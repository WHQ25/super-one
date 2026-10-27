import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { ANDROID_PHONE_REFERENCE_MODEL } from '@superone/shared/device'
import type { UsdzVariantSet } from './usdz-preview'

const paths = vi.hoisted(() => ({ dev: true, app: '', userData: '', developer: '' }))
vi.mock('electron', () => ({ app: { getAppPath: () => paths.app, getPath: () => paths.userData } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { get dev() { return paths.dev } } }))
vi.mock('./ios-simulator/simctl', () => ({ selectedDeveloperDirectory: async () => paths.developer }))
const compose = vi.hoisted(() => vi.fn())
vi.mock('./usdz-preview', () => ({ composeUsdzPreview: compose }))

import { listDeviceModels, loadDeviceModel, readFoldClip } from './device-models'

let root: string
const file = 'android-reference/pixel-10-pro-D008-esim.glb'
const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46])

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'superone-device-models-'))
  paths.app = root
  paths.userData = join(root, 'user-data')
  paths.developer = join(root, 'Xcode.app', 'Contents', 'Developer')
})

afterAll(async () => { await rm(root, { recursive: true, force: true }) })

/** Where the selected Xcode keeps the Duo's body. */
async function installXcodeModel(): Promise<void> {
  const resources = join(
    root, 'Xcode.app', 'Contents', 'SharedFrameworks', 'DeviceKit.framework', 'Versions', 'A', 'PlugIns',
    'CoreDevicePopDeviceKitExtension.devicekitplugin', 'Contents', 'Resources',
  )
  await mkdir(resources, { recursive: true })
  await writeFile(join(resources, 'V68.usdz'), bytes)
}

describe('Android phone reference model', () => {
  for (const [mode, dev, directory] of [
    ['development', true, '.device-models'],
    ['packaged', false, 'user-data/device-models'],
  ] as const) {
    it(`loads only an installed local GLB in ${mode}`, async () => {
      paths.dev = dev
      expect(await listDeviceModels()).not.toContain(ANDROID_PHONE_REFERENCE_MODEL)
      expect(await loadDeviceModel(ANDROID_PHONE_REFERENCE_MODEL)).toBeNull()

      const path = join(root, directory, file)
      await mkdir(join(root, directory, 'android-reference'), { recursive: true })
      await writeFile(path, bytes)
      expect(await listDeviceModels()).toContain(ANDROID_PHONE_REFERENCE_MODEL)
      expect(await loadDeviceModel(ANDROID_PHONE_REFERENCE_MODEL)).toEqual({
        archive: new Uint8Array(await readFile(path)),
        format: 'glb',
        screen: 'only',
        screenMeshName: 'Display',
        flipScreenV: true,
      })
    })
  }
})

describe('Xcode-provided models', () => {
  it.runIf(process.platform === 'darwin')('lists the iPhone Duo only when the selected Xcode ships its body', async () => {
    expect(await listDeviceModels()).not.toContain('iPhone Duo')
    await installXcodeModel()
    expect(await listDeviceModels()).toContain('iPhone Duo')
  })

  it.runIf(process.platform === 'darwin')('wears the finish asked for when the scene offers it, else its own', async () => {
    await installXcodeModel()
    const archive = zipSync({ 'preview.usda': strToU8(
      'def RealityKitAction "Animation"\n{\n    string animation = "book_close"\n    double duration = 5\n    double startTime = 10\n}\n',
    ) })
    // V68 names its finishes `color`; Apple's web scenes say `Color`.
    compose.mockImplementation(async (_input: Uint8Array, select: (variants: UsdzVariantSet[]) => Record<string, string>) => {
      const declared = [{ name: 'color', options: ['Dark', 'Light'], selected: 'Light' }]
      const picked = select(declared)
      return { archive, variants: declared.map((set) => ({ ...set, selected: picked[set.name] ?? set.selected })) }
    })

    const dark = await loadDeviceModel('iPhone Duo', 'Dark')
    expect(dark).toEqual(expect.objectContaining({ fold: { start: 10, duration: 5 }, colors: { options: ['Dark', 'Light'], selected: 'Dark' } }))
    // A finish a later Xcode dropped is not an error: the body wears its default.
    expect((await loadDeviceModel('iPhone Duo', 'Gold'))?.colors?.selected).toBe('Light')
    expect((await loadDeviceModel('iPhone Duo'))?.colors?.selected).toBe('Light')
  })
})

describe('readFoldClip', () => {
  // The shape of Xcode 27's V68 timeline, trimmed to two actions.
  const usda = `
    def RealityKitTimeline "Timeline"
    {
        def RealityKitTrack "Track"
        {
            def RealityKitAction "Animation"
            {
                string animation = "r_over_l"
                double duration = 5.041666666666667
                double startTime = 0
                def RealityKitStruct "handoffType"
                {
                }
            }
        }
        def RealityKitTrack "Track2"
        {
            def RealityKitAction "Animation"
            {
                string animation = "book_close"
                double duration = 5.041666666666667
                double startTime = 10.833333333333334
            }
        }
    }`

  it('reads the named clip\'s own cut of the shared timeline', () => {
    expect(readFoldClip(usda, 'book_close')).toEqual({ start: 10.833333333333334, duration: 5.041666666666667 })
    expect(readFoldClip(usda, 'r_over_l')).toEqual({ start: 0, duration: 5.041666666666667 })
  })

  it('refuses a clip that is absent or has no length', () => {
    expect(readFoldClip(usda, 'tent')).toBeNull()
    expect(readFoldClip(usda.replace('double duration = 5.041666666666667\n                double startTime = 0', 'double startTime = 0'), 'r_over_l')).toBeNull()
  })
})
