import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ANDROID_PHONE_REFERENCE_MODEL } from '@superone/shared/device'

const paths = vi.hoisted(() => ({ dev: true, app: '', userData: '' }))
vi.mock('electron', () => ({ app: { getAppPath: () => paths.app, getPath: () => paths.userData } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { get dev() { return paths.dev } } }))

import { listDeviceModels, loadDeviceModel } from './device-models'

let root: string
const file = 'android-reference/pixel-10-pro-D008-esim.glb'
const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46])

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'superone-device-models-'))
  paths.app = root
  paths.userData = join(root, 'user-data')
})

afterAll(async () => { await rm(root, { recursive: true, force: true }) })

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
