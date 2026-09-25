/** @vitest-environment jsdom */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { Box3, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three'
import { parseModel, updateModelCameraClipPlanes } from './model-loader'

const fixtures = join(import.meta.dirname, '__fixtures__')

function triangle(name: string, body = '', material?: string): string {
  return `def Mesh "${name}"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(-1, -1, 0), (1, -1, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (interpolation = "vertex")
        uniform token subdivisionScheme = "none"
${body}${material ? `        rel material:binding = </Root/${material}>\n` : ''}    }`
}

function surface(name: string, inputs: string, extra = ''): string {
  return `def Material "${name}"
    {
        token outputs:surface.connect = </Root/${name}/Shader.outputs:surface>
        def Shader "Shader"
        {
            uniform token info:id = "UsdPreviewSurface"
${inputs}
            token outputs:surface
        }
${extra}
    }`
}

function meshes(object: { traverse(callback: (part: unknown) => void): void }): Map<string, Mesh> {
  const found = new Map<string, Mesh>()
  object.traverse((part) => { if (part instanceof Mesh) found.set(part.name, part) })
  return found
}

describe('parseModel', () => {
  for (const name of ['Box.glb', 'triangle.usda', 'triangle.usdc', 'triangle.usd', 'triangle.usdz']) {
    it(`loads ${name} with visible geometry`, async () => {
      const bytes = await readFile(join(fixtures, name))
      const data = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(data).set(bytes)
      const model = await parseModel(name, data)
      let meshes = 0
      model.object.traverse((part) => { if ('geometry' in part) meshes++ })
      expect(meshes).toBeGreaterThan(0)
    })
  }

  it('rejects an unsupported extension', async () => {
    await expect(parseModel('a.xyz', new ArrayBuffer(0))).rejects.toThrow('Unsupported 3D format')
  })

  it('keeps authored USD color values in linear space', async () => {
    const stage = `#usda 1.0
(defaultPrim = "Root")
def Xform "Root"
{
    def Mesh "Triangle"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(-1, -1, 0), (1, -1, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
        rel material:binding = </Root/Finish>
    }
    def Material "Finish"
    {
        token outputs:surface.connect = </Root/Finish/Shader.outputs:surface>
        def Shader "Shader"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0.05, 0.02, 0.01)
            color3f inputs:emissiveColor = (0.1, 0.04, 0.02)
            token outputs:surface
        }
    }
}`
    const model = await parseModel('color.usda', new TextEncoder().encode(stage).buffer as ArrayBuffer)
    let material: MeshStandardMaterial | undefined
    model.object.traverse((part) => {
      if (part instanceof Mesh) material = part.material as MeshStandardMaterial
    })
    expect(material?.color.r).toBeCloseTo(0.05)
    expect(material?.color.g).toBeCloseTo(0.02)
    expect(material?.emissive.r).toBeCloseTo(0.1)
  })

  it('loads a glTF with a sibling binary buffer', async () => {
    const gltf = await readFile(join(fixtures, 'Box.gltf'))
    const binary = await readFile(join(fixtures, 'Box0.bin'))
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource) => {
      const url = resource instanceof Request ? resource.url : String(resource)
      expect(url).toBe('https://preview.test/model/Box0.bin')
      return new Response(new Uint8Array(binary), { headers: { 'Content-Type': 'application/octet-stream' } })
    })
    try {
      const data = new ArrayBuffer(gltf.length)
      new Uint8Array(data).set(gltf)
      const model = await parseModel('Box.gltf', data, 'https://preview.test/model/')
      let meshes = 0
      model.object.traverse((part) => { if ('geometry' in part) meshes++ })
      expect(meshes).toBeGreaterThan(0)
    } finally {
      fetch.mockRestore()
    }
  })

  it('rejects an external glTF resource outside the model folder', async () => {
    const gltf = (await readFile(join(fixtures, 'Box.gltf'), 'utf8')).replace('Box0.bin', 'https://example.com/Box0.bin')
    const encoded = new TextEncoder().encode(gltf)
    const data = new ArrayBuffer(encoded.byteLength)
    new Uint8Array(data).set(encoded)
    await expect(parseModel('Box.gltf', data, 'https://preview.test/model/')).rejects.toThrow('outside the model folder')
  })

  it('applies suffixed xformOps such as Maya rotate pivots', async () => {
    const stage = `#usda 1.0
(defaultPrim = "Root")
def Xform "Root"
{
    ${triangle('Part', `        float3 xformOp:rotateXYZ = (0, 180, 0)
        float3 xformOp:translate:rotatePivot = (1, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate:rotatePivot", "xformOp:rotateXYZ", "!invert!xformOp:translate:rotatePivot"]
`)}
}`
    const model = await parseModel('pivot.usda', new TextEncoder().encode(stage).buffer as ArrayBuffer)
    expect(meshes(model.object).get('Part')?.position.x).toBeCloseTo(2)
  })

  it('maps UsdPreviewSurface inputs by the specification', async () => {
    const stage = `#usda 1.0
(defaultPrim = "Root")
def Xform "Root"
{
    ${triangle('Bumped', '', 'BumpedFinish')}
    ${triangle('Masked', '', 'MaskedFinish')}
    ${surface('BumpedFinish', `            normal3f inputs:normal.connect = </Root/BumpedFinish/Normal.outputs:rgb>
            color3f inputs:specularColor = (0, 0, 0)`, `        def Shader "Normal"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @normal.png@
            float4 inputs:bias = (-1, -1, -1, 0)
            float4 inputs:scale = (2, 2, 2, 1)
            float3 outputs:rgb
        }`)}
    ${surface('MaskedFinish', `            float inputs:opacity = 0.5
            float inputs:opacityThreshold = 0.1`)}
}`
    const archive = zipSync({ 'stage.usda': new TextEncoder().encode(stage), 'normal.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, { level: 0 })
    const model = await parseModel('materials.usdz', archive.buffer as ArrayBuffer)
    const found = meshes(model.object)
    const bumped = found.get('Bumped')?.material as MeshPhysicalMaterial
    const masked = found.get('Masked')?.material as MeshPhysicalMaterial
    expect(bumped.normalMap).toBeTruthy()
    expect(bumped.normalScale.toArray()).toEqual([1, 1])
    expect(bumped.specularColor.getHex()).toBe(0xffffff)
    expect(masked.alphaTest).toBeCloseTo(0.1)
    expect(masked.transparent).toBe(false)
  })
})

describe('updateModelCameraClipPlanes', () => {
  it('keeps the near plane off zero when the camera is inside the bounding sphere', () => {
    const bounds = new Box3(new Vector3(-4, -8, -0.4), new Vector3(4, 8, 0.4))
    const radius = bounds.getSize(new Vector3()).length() / 2
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 4.4)
    updateModelCameraClipPlanes(camera, bounds, radius)
    expect(camera.near).toBeCloseTo(2)
    camera.position.set(0, 0, 0.2)
    updateModelCameraClipPlanes(camera, bounds, radius)
    expect(camera.near).toBeCloseTo(radius / 1000)
  })
})

