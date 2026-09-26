import { Box3, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D, type Ray } from 'three'
import type { DeviceModelScreenPick } from '@superone/shared/device'
import type { NormalizedFramePoint } from './device-input'

/**
 * The glass as an affine plane: `origin` is uv (0,0), and moving one unit of u or v
 * moves along `u` or `v`. Apple's screen meshes are flat with UVs spanning the whole
 * framebuffer, so this maps a ray to a touch without raycasting the mesh.
 */
export interface DeviceScreenFrame {
  origin: Vector3
  u: Vector3
  v: Vector3
  /** Outward, towards whoever is looking at the screen. */
  normal: Vector3
}

export interface PreparedDeviceModel {
  /** The one device, screen facing +Z and upright, centred on the origin. */
  root: Group
  screen: Mesh
  /** In `root`'s own space. */
  frame: DeviceScreenFrame
}

/** Planar fit tolerance, in UV units: Apple's worst flat screen measures under 0.01. */
const PLANAR_UV_TOLERANCE = 0.02

/**
 * Apple's exports name every prim with random letters, so the screen is found by what
 * it is: a black surface lit only by the wallpaper texture it emits.
 */
function isScreenMaterial(material: Material): material is MeshStandardMaterial {
  return material instanceof MeshStandardMaterial
    && material.emissiveMap !== null
    && material.map === null
    && material.color.r + material.color.g + material.color.b < 1e-3
}

function screenCandidates(object: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  object.traverse((part) => {
    if (!(part instanceof Mesh) || Array.isArray(part.material)) return
    if (isScreenMaterial(part.material)) meshes.push(part)
  })
  return meshes
}

/**
 * Least-squares fit of world position = origin + u·U + v·V over every vertex.
 *
 * Null when the mesh is not one flat, linearly mapped sheet — the edge glass some
 * models bind to the screen material, and the Duo's folding inner screen.
 */
export function fitScreenFrame(mesh: Mesh): DeviceScreenFrame | null {
  const position = mesh.geometry.getAttribute('position')
  const uv = mesh.geometry.getAttribute('uv')
  if (!position || !uv || position.count < 3) return null
  mesh.updateWorldMatrix(true, false)
  // Normal equations for [u v 1] · [U V O]ᵀ = p, solved per axis.
  const ata = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
  const sums = { uu: 0, uv: 0, u1: 0, vv: 0, v1: 0, n: 0 }
  const atp = [new Vector3(), new Vector3(), new Vector3()]
  const points: Array<[number, number, Vector3]> = []
  const point = new Vector3()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    const u = uv.getX(i)
    const v = uv.getY(i)
    points.push([u, v, point.clone()])
    sums.uu += u * u; sums.uv += u * v; sums.u1 += u
    sums.vv += v * v; sums.v1 += v; sums.n += 1
    atp[0].addScaledVector(point, u)
    atp[1].addScaledVector(point, v)
    atp[2].add(point)
  }
  ata.set(
    sums.uu, sums.uv, sums.u1, 0,
    sums.uv, sums.vv, sums.v1, 0,
    sums.u1, sums.v1, sums.n, 0,
    0, 0, 0, 1,
  )
  if (Math.abs(ata.determinant()) < 1e-12) return null
  const inverse = ata.invert().elements
  // Column-major: row r of the inverse is elements[r], [r + 4], [r + 8].
  const solve = (row: number) => new Vector3()
    .addScaledVector(atp[0], inverse[row])
    .addScaledVector(atp[1], inverse[row + 4])
    .addScaledVector(atp[2], inverse[row + 8])
  const frame = { u: solve(0), v: solve(1), origin: solve(2) }
  const normal = new Vector3().crossVectors(frame.u, frame.v)
  if (normal.lengthSq() === 0) return null
  normal.normalize()
  const scale = Math.max(frame.u.length(), frame.v.length())
  const predicted = new Vector3()
  for (const [u, v, p] of points) {
    predicted.copy(frame.origin).addScaledVector(frame.u, u).addScaledVector(frame.v, v)
    if (predicted.distanceTo(p) > PLANAR_UV_TOLERANCE * scale) return null
  }
  return { ...frame, normal }
}

/** A body at most this much wider or taller than its glass, and this thick. */
const BODY_PLANE_MARGIN = 1.3
const BODY_MAX_DEPTH = 0.25

/**
 * Each mesh's exact bounds along the glass's own axes, from its vertices.
 *
 * Not the transformed local box: Apple leans the iPads against their keyboards, so
 * a flat part's local box is already thick, and turning its corners into the
 * glass's axes reports a slab where there is a sheet.
 */
function boundsAlongScreen(object: Object3D, toScreen: Matrix4): Map<Mesh, Box3> {
  const bounds = new Map<Mesh, Box3>()
  const matrix = new Matrix4()
  const point = new Vector3()
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const position = child.geometry.getAttribute('position')
    if (!position) return
    matrix.multiplyMatrices(toScreen, child.matrixWorld)
    const box = new Box3()
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(matrix))
    bounds.set(child, box)
  })
  return bounds
}

function sizeOf(node: Object3D, bounds: Map<Mesh, Box3>): Vector3 {
  const box = new Box3()
  node.traverse((child) => { const part = child instanceof Mesh ? bounds.get(child) : undefined; if (part) box.union(part) })
  return box.getSize(new Vector3())
}

/**
 * The highest ancestor of `screen` that is still one device.
 *
 * Apple's Pro scenes stand the Pro and the Pro Max side by side, and the iPad scenes
 * prop the tablet on its keyboard with a pencil beside it; each device is its own
 * subtree. Climbing stops before a parent holds another screen or grows past what a
 * body around this glass could measure.
 */
function deviceComponent(scene: Object3D, screen: Mesh, frame: DeviceScreenFrame, others: readonly Mesh[]): Object3D {
  const bounds = boundsAlongScreen(scene, screenBasis(frame).invert())
  const width = frame.u.length()
  const height = frame.v.length()
  let node: Object3D = screen
  while (node.parent) {
    const parent = node.parent
    let shared = false
    parent.traverse((part) => { if (part !== screen && others.includes(part as Mesh)) shared = true })
    if (shared) break
    const size = sizeOf(parent, bounds)
    if (size.x > width * BODY_PLANE_MARGIN || size.y > height * BODY_PLANE_MARGIN) break
    if (size.z > Math.min(width, height) * BODY_MAX_DEPTH) break
    node = parent
  }
  return node
}

/** Rotation taking +X, +Y, +Z to the glass's right, up and outward directions. */
function screenBasis(frame: DeviceScreenFrame): Matrix4 {
  const right = frame.u.clone().normalize()
  const up = new Vector3().crossVectors(frame.normal, right)
  return new Matrix4().makeBasis(right, up, frame.normal)
}

/** `frame` carried through a rigid transform, e.g. from `root` space to world space. */
export function transformFrame(frame: DeviceScreenFrame, matrix: Matrix4): DeviceScreenFrame {
  return {
    origin: frame.origin.clone().applyMatrix4(matrix),
    u: frame.u.clone().transformDirection(matrix).multiplyScalar(frame.u.length()),
    v: frame.v.clone().transformDirection(matrix).multiplyScalar(frame.v.length()),
    normal: frame.normal.clone().transformDirection(matrix),
  }
}

/**
 * Cut one device out of Apple's AR scene and stand it facing the camera.
 *
 * The scene is modified in place: the other device in a two-size scene is detached,
 * and the caller disposes it along with everything else it loaded.
 */
export function prepareDeviceModel(object: Object3D, pick: DeviceModelScreenPick): PreparedDeviceModel {
  object.updateMatrixWorld(true)
  const screens = screenCandidates(object)
    .map((mesh) => ({ mesh, frame: fitScreenFrame(mesh) }))
    .filter((entry): entry is { mesh: Mesh; frame: DeviceScreenFrame } => entry.frame !== null)
    .map((entry) => ({ ...entry, area: new Vector3().crossVectors(entry.frame.u, entry.frame.v).length() }))
    .sort((a, b) => a.area - b.area)
  if (screens.length === 0) throw new Error('No device screen found in model')
  if (pick === 'only' && screens.length > 1) {
    // A two-size scene misread as one device would hand back the wrong phone.
    const [smallest, largest] = [screens[0].area, screens[screens.length - 1].area]
    if (largest / smallest > 1.02) throw new Error('Model holds more than one device')
  }
  const chosen = pick === 'smallest' ? screens[0] : screens[screens.length - 1]
  const component = deviceComponent(object, chosen.mesh, chosen.frame, screens.map((entry) => entry.mesh))

  // Re-home the component under a fresh root, keeping its world placement.
  const world = component.matrixWorld.clone()
  component.removeFromParent()
  world.decompose(component.position, component.quaternion, component.scale)
  const root = new Group()
  root.add(component)

  // Screen-right → +X, screen-up → +Y, outward → +Z.
  root.quaternion.setFromRotationMatrix(screenBasis(chosen.frame)).invert()
  root.updateMatrixWorld(true)
  const center = new Box3().setFromObject(root, true).getCenter(new Vector3())
  root.position.sub(center)
  root.updateMatrixWorld(true)

  // The component's local matrix IS its old world matrix, so root space is the
  // scene's old world space and the fitted frame carries over unchanged.
  return { root, screen: chosen.mesh, frame: chosen.frame }
}

/**
 * The framebuffer point a ray lands on, or null when it misses the front of the glass.
 *
 * `clamp` keeps a drag that started on the glass alive after it slides off the
 * edge, the way the flat view pins it to the border.
 */
export function projectRayToScreen(ray: Ray, frame: DeviceScreenFrame, clamp: boolean): NormalizedFramePoint | null {
  const facing = ray.direction.dot(frame.normal)
  // From behind or edge-on the body is in the way.
  if (facing >= -1e-6) return null
  const t = new Vector3().subVectors(frame.origin, ray.origin).dot(frame.normal) / facing
  if (t < 0) return null
  const d = ray.at(t, new Vector3()).sub(frame.origin)
  const a = frame.u.dot(frame.u)
  const b = frame.u.dot(frame.v)
  const c = frame.v.dot(frame.v)
  const du = d.dot(frame.u)
  const dv = d.dot(frame.v)
  const det = a * c - b * b
  const u = (c * du - b * dv) / det
  const v = (a * dv - b * du) / det
  // Textures upload flipped, so v = 1 is the framebuffer's top row.
  const point = { xRatio: u, yRatio: 1 - v }
  const inside = point.xRatio >= 0 && point.xRatio <= 1 && point.yRatio >= 0 && point.yRatio <= 1
  if (!inside && !clamp) return null
  return {
    xRatio: Math.min(1, Math.max(0, point.xRatio)),
    yRatio: Math.min(1, Math.max(0, point.yRatio)),
  }
}
