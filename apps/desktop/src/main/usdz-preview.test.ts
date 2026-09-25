/** @vitest-environment jsdom */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Box3, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Material, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { parseModel } from '../renderer/src/components/coding/model-loader'
import { composeUsdzPreview, inspectRootVariants, normalizeUsdaForThree } from './usdz-preview'

it('extracts root variant choices and their default selection', () => {
  const stage = `#usda 1.0\n(defaultPrim = "Device")\nover "Device" (\n variants = { string Pose = "Closed" }\n)\n{\n    variantSet "Pose" = {\n        "Closed" {}\n        "Open" {}\n    }\n}\n`
  expect(inspectRootVariants(stage)).toEqual({
    root: 'Device',
    variants: [{ name: 'Pose', options: ['Closed', 'Open'], selected: 'Closed' }],
  })
})

it('keeps material scopes after MaterialX output metadata', async () => {
  const stage = `#usda 1.0
(defaultPrim = "Root")
def Xform "Root"
{
    def Mesh "Face"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(-1, -1, 0), (1, -1, 0), (0, 1, 0)]
        rel material:binding = </Root/Looks/Finish>
    }
    def Scope "Looks"
    {
        def Material "Unused"
        {
            token outputs:mtlx:surface (
                sdrMetadata = {
                    string uiorder = "1"
                }
            )
        }
        def Material "Finish"
        {
            token outputs:surface.connect = </Root/Looks/Finish/Shader.outputs:surface>
            def Shader "Shader"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.2, 0.1, 0.05)
                token outputs:surface
            }
        }
    }
}`
  const model = await parseModel('material.usda', new TextEncoder().encode(normalizeUsdaForThree(stage)).buffer as ArrayBuffer)
  let material: MeshStandardMaterial | undefined
  model.object.traverse((part) => { if (part instanceof Mesh) material = part.material as MeshStandardMaterial })
  expect(material?.color.r).toBeCloseTo(0.2)
  expect(material?.color.g).toBeCloseTo(0.1)
})

it.skipIf(process.platform !== 'darwin')('composes a local USDZ variant into different geometry', async () => {
  const source = new Uint8Array(await readFile(join(import.meta.dirname, '../renderer/src/components/coding/__fixtures__/variant-card.usdz')))
  const closed = await composeUsdzPreview(source)
  const open = await composeUsdzPreview(source, { Pose: 'Open' })
  expect(closed.variants).toEqual([{ name: 'Pose', options: ['Closed', 'Open'], selected: 'Closed' }])
  expect(open.variants[0].selected).toBe('Open')
  const size = async (archive: Uint8Array) => {
    const bytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
    return new Box3().setFromObject((await parseModel('variant-card.usdz', bytes)).object).getSize(new Vector3())
  }
  const closedSize = await size(closed.archive)
  const openSize = await size(open.archive)
  expect(closedSize.x).toBeCloseTo(1)
  expect(closedSize.y).toBeCloseTo(2)
  expect(openSize.x).toBeCloseTo(2)
  expect(openSize.y).toBeCloseTo(1)
  await expect(composeUsdzPreview(source, { Pose: 'Missing' })).rejects.toThrow('Unsupported USDZ variant')
})

const samples = process.env.SUPERONE_APPLE_3D_SAMPLES

function materialCoverage(object: Object3D): { textured: number; plainWhite: number } {
  let textured = 0
  let plainWhite = 0
  object.traverse((part) => {
    if (!('material' in part)) return
    const material = (part as Object3D & { material: Material & { map?: unknown; color?: { getHexString(): string } } }).material
    if (material.map) textured++
    if (!material.map && material.color?.getHexString() === 'ffffff') plainWhite++
  })
  return { textured, plainWhite }
}

describe.skipIf(!samples)('Apple USDZ variant composition', () => {
  it('preserves the iPhone 17e materials after flattening', async () => {
    const source = new Uint8Array(await readFile(join(samples!, 'iphone-17e.usdz')))
    const result = await composeUsdzPreview(source)
    const model = await parseModel('iphone-17e.usdz', result.archive.buffer.slice(result.archive.byteOffset, result.archive.byteOffset + result.archive.byteLength) as ArrayBuffer)
    expect(materialCoverage(model.object)).toEqual({ textured: 14, plainWhite: 1 })
  })

  it('composes a selectable iPhone color into visible geometry', async () => {
    const source = new Uint8Array(await readFile(join(samples!, 'iphone-18-pro-and-pro-max.usdz')))
    const result = await composeUsdzPreview(source, { Color: 'Glacier' })
    expect(result.variants).toEqual([{ name: 'Color', options: ['Black', 'Burgundy', 'Glacier', 'Silver'], selected: 'Glacier' }])
    const model = await parseModel('iphone-18-pro-and-pro-max.usdz', result.archive.buffer.slice(result.archive.byteOffset, result.archive.byteOffset + result.archive.byteLength) as ArrayBuffer)
    expect(new Box3().setFromObject(model.object).isEmpty()).toBe(false)
    expect(materialCoverage(model.object).textured).toBe(52)
  })

  it('changes the Duo pose while retaining its color set', async () => {
    const source = new Uint8Array(await readFile(join(samples!, 'iphone-duo.usdz')))
    const closed = await composeUsdzPreview(source, { Pose: 'Closed' })
    const landscape = await composeUsdzPreview(source, { Pose: 'Landscape' })
    expect(landscape.variants.map((set) => set.name)).toEqual(['Color', 'Pose'])
    expect(landscape.variants.find((set) => set.name === 'Pose')?.selected).toBe('Landscape')
    const geometryHashes: string[] = []
    for (const result of [closed, landscape]) {
      const model = await parseModel('iphone-duo.usdz', result.archive.buffer.slice(result.archive.byteOffset, result.archive.byteOffset + result.archive.byteLength) as ArrayBuffer)
      expect(materialCoverage(model.object).textured).toBeGreaterThan(10)
      expect(materialCoverage(model.object).plainWhite).toBeLessThan(5)
      const hash = createHash('sha256')
      model.object.traverse((part) => {
        const geometry = (part as typeof part & { geometry?: BufferGeometry }).geometry
        const position = geometry?.getAttribute('position')
        if (position) hash.update(Buffer.from(position.array.buffer, position.array.byteOffset, position.array.byteLength))
      })
      geometryHashes.push(hash.digest('hex'))
    }
    expect(geometryHashes[0]).not.toEqual(geometryHashes[1])
  })
})
