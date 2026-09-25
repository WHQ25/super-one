import { BufferGeometry, DoubleSide, Group, LoadingManager, Mesh, MeshStandardMaterial, Vector3, type AnimationClip, type Box3, type Object3D, type PerspectiveCamera } from 'three'

export interface LoadedModel {
  object: Object3D
  animations: AnimationClip[]
}

/** Fit a bounding sphere within both the vertical and horizontal field of view. */
export function placeModelCamera(camera: PerspectiveCamera, bounds: Box3, radius: number, direction = new Vector3(2.3, 1.4, 2.3)): void {
  const verticalFov = camera.fov * Math.PI / 180
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
  const distance = Math.max(radius * 3.55, radius * 1.15 / Math.sin(Math.min(verticalFov, horizontalFov) / 2))
  camera.position.copy(bounds.getCenter(new Vector3())).add(direction.clone().normalize().multiplyScalar(distance))
  updateModelCameraClipPlanes(camera, bounds, radius)
}

/**
 * Keep the depth range close to the model so thin USD surface layers remain distinct.
 * The box, unlike the bounding sphere, stays tight on flat devices, so zooming in
 * does not collapse the near plane and make decals such as logos z-fight.
 */
export function updateModelCameraClipPlanes(camera: PerspectiveCamera, bounds: Box3, radius: number): void {
  const near = Math.max(bounds.distanceToPoint(camera.position) * 0.5, radius / 1000)
  const far = Math.max(camera.position.distanceTo(bounds.getCenter(new Vector3())) + radius * 2, near + 1)
  if (Math.abs(camera.near - near) < near * 0.001 && Math.abs(camera.far - far) < far * 0.001) return
  camera.near = near
  camera.far = far
  camera.updateProjectionMatrix()
}

/** Keep optional parsers out of the main renderer bundle. */
export async function parseModel(name: string, bytes: ArrayBuffer, baseUrl = ''): Promise<LoadedModel> {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const manager = new LoadingManager()
  manager.setURLModifier((resource) => {
    if (/^(?:data|blob):/.test(resource)) return resource
    if (!baseUrl) throw new Error('External model resources need a local folder')
    const resolved = new URL(resource, baseUrl)
    const base = new URL(baseUrl)
    if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
      throw new Error('External model resource is outside the model folder')
    }
    return resolved.href
  })
  switch (ext) {
    case '.glb':
    case '.gltf': {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
      const gltf = await new GLTFLoader(manager).parseAsync(bytes, baseUrl)
      return { object: gltf.scene, animations: gltf.animations }
    }
    case '.usd':
    case '.usda':
    case '.usdc':
    case '.usdz': {
      if (ext === '.usdz') validateZipSize(bytes)
      const { USDLoader } = await import('three/addons/loaders/USDLoader.js')
      const object = new USDLoader(manager).parse(bytes, baseUrl)
      restoreUsdLinearColors(object)
      return { object, animations: [] }
    }
    case '.obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
      const object = new OBJLoader().parse(new TextDecoder().decode(bytes))
      return { object, animations: [] }
    }
    case '.fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
      const object = new FBXLoader(manager).parse(bytes, baseUrl)
      return { object, animations: object.animations }
    }
    case '.stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
      const geometry = new STLLoader().parse(bytes)
      if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
      return meshModel(geometry)
    }
    case '.ply': {
      const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js')
      const geometry = new PLYLoader().parse(bytes)
      if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
      return meshModel(geometry)
    }
    case '.3mf': {
      validateZipSize(bytes)
      const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js')
      const object = new ThreeMFLoader(manager).parse(bytes)
      return { object, animations: [] }
    }
    default:
      throw new Error(`Unsupported 3D format: ${ext}`)
  }
}

/** USD color attributes default to linear Rec.709; Three's loader currently decodes them as sRGB. */
function restoreUsdLinearColors(object: Object3D): void {
  const seen = new Set<MeshStandardMaterial>()
  object.traverse((part) => {
    if (!('material' in part)) return
    const materials = (part as Mesh).material
    for (const material of Array.isArray(materials) ? materials : [materials]) {
      if (!(material instanceof MeshStandardMaterial) || seen.has(material)) continue
      seen.add(material)
      material.color.convertLinearToSRGB()
      material.emissive.convertLinearToSRGB()
    }
  })
}

/** Reject oversized archives before Three inflates every entry in memory. */
function validateZipSize(bytes: ArrayBuffer): void {
  const view = new DataView(bytes)
  const end = bytes.byteLength
  let eocd = -1
  for (let i = end - 22; i >= Math.max(0, end - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Invalid model archive')
  const count = view.getUint16(eocd + 10, true)
  const offset = view.getUint32(eocd + 16, true)
  if (count > 2048 || offset >= end) throw new Error('Model archive is too large')
  let total = 0
  let at = offset
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new Error('Invalid model archive')
    const expanded = view.getUint32(at + 24, true)
    if (expanded === 0xffffffff) throw new Error('ZIP64 model archives are unsupported')
    total += expanded
    if (total > 256 * 1024 * 1024) throw new Error('Model archive exceeds 256 MB expanded limit')
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
}

function meshModel(geometry: BufferGeometry): LoadedModel {
  const material = new MeshStandardMaterial({ color: 0xb8c5d3, vertexColors: geometry.hasAttribute('color'), side: DoubleSide })
  const group = new Group()
  group.add(new Mesh(geometry, material))
  return { object: group, animations: [] }
}
