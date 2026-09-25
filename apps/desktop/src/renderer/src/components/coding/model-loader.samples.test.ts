/** @vitest-environment jsdom */
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseModel } from './model-loader'

/** Run with SUPERONE_3D_SAMPLES=~/Downloads/SuperOne-3D-Test-Assets. */
const sampleDir = process.env.SUPERONE_3D_SAMPLES
const appleDir = process.env.SUPERONE_APPLE_3D_SAMPLES
const flattenedUsdz = process.env.SUPERONE_FLATTENED_USDZ_SAMPLE

async function check(name: string, filePath: string): Promise<void> {
  let bytes = await readFile(filePath)
  if (name === 'Box.gltf') {
    // The parser test has no URL origin. The desktop's media server supplies
    // the real sibling Box0.bin when a user opens the downloaded file.
    const sibling = await readFile(join(sampleDir!, 'Box0.bin'))
    bytes = Buffer.from(bytes.toString('utf8').replace('Box0.bin', `data:application/octet-stream;base64,${sibling.toString('base64')}`))
  }
  const data = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(data).set(bytes)
  const model = await parseModel(name, data, '')
  let meshes = 0
  model.object.traverse((part) => { if ('geometry' in part) meshes++ })
  expect(meshes).toBeGreaterThan(0)
}

describe.skipIf(!sampleDir)('downloaded open 3D samples', () => {
  for (const name of ['Box.glb', 'Box.gltf', 'tree.obj', 'nurbs.fbx', 'vCube.fbx', 'slotted_disk.stl', 'dolphins_colored.ply', 'facecolors.3mf']) {
    it(name, async () => {
      await check(name, join(sampleDir!, name))
    })
  }
})

describe.skipIf(!appleDir)('Apple USDZ sample', () => {
  const unsupported = new Set(['iphone-18-pro-and-pro-max.usdz', 'iphone-duo.usdz'])
  for (const name of appleDir ? readdirSync(appleDir).filter((file) => file.endsWith('.usdz')) : []) {
    const run = unsupported.has(name) ? it.fails : it
    run(name, async () => {
      await check(name, join(appleDir!, name))
    })
  }
})

it.skipIf(!flattenedUsdz)('loads a flattened USDZ fallback', async () => {
  await check('flattened.usdz', flattenedUsdz!)
})
