import {
  AnimationMixer,
  Box3,
  Matrix4,
  MeshBasicMaterial,
  SkinnedMesh,
  Vector3,
  type Mesh,
  type Object3D,
  type Quaternion,
  type Raycaster,
  type Texture,
} from 'three'
import type { DeviceModelScreenPick } from '@superone/shared/device'
import { normalizeFramePoint, type NormalizedFramePoint } from './device-input'
import {
  fitScreenFrame,
  foldPose,
  prepareDeviceModel,
  prepareFoldableModel,
  projectRayToScreen,
  transformFrame,
  type DeviceScreenFrame,
} from './device-model-scene'

/** A foldable's hinge, 0 closed to 180 open, and the screen the device has lit. */
export interface DeviceModelFold {
  hingeDegrees: number
  panel: 'cover' | 'inner'
  /**
   * The clockwise turn that stands the lit panel's framebuffer upright. Apple maps
   * the model's glass as the panel is seen, so the picture turns onto it by this much
   * and the stage need not turn for it.
   */
  panelRotation: number
  /** Laid as a laptop: posed as when open, then tipped by the renderer so one half lies flat. */
  laptop: boolean
  /**
   * The screen turned to the camera, when not the lit one: a hinge held past the other
   * panel's angle, before the guest has swapped. Its glass stays dark until it lights.
   */
  facing?: 'cover' | 'inner'
}

/**
 * The device in the scene, whatever kind of body it is.
 *
 * A rigid phone and a foldable differ in everything the renderer asks of the glass —
 * where it is, what a ray hits, which screen carries the picture — so they answer
 * those questions themselves and the renderer stays one path.
 */
export interface DeviceBody {
  /** Goes in the stage; the body places it. */
  root: Object3D
  /** The lit glass in world space, along the framebuffer's own axes. */
  frame(): DeviceScreenFrame
  /** How much of the device's turn the glass's own mapping already shows. */
  turnOffset(): number
  point(raycaster: Raycaster, clamp: boolean): NormalizedFramePoint | null
  /** The picture on the lit glass, or a black screen for null. */
  paint(texture: Texture | null): void
  /** In the stage's own space; changes only when the body moves. */
  bounds(): Box3
  /** The hinge's angle right now, mid-move included; 0 for a rigid body. */
  hinge(): number
  /** Advances a running fold. True while it still moves. */
  step(now: number): boolean
  /** Bends to `state` when `animate`, at `HINGE_DEGREES_PER_SECOND` within `HINGE_MAX_MOVE_MS`; else at once. */
  fold(state: DeviceModelFold, animate: boolean): void
  dispose(): void
}

const screenMaterial = () => new MeshBasicMaterial({ color: 0x000000, toneMapped: false })

/** `frame` re-expressed along a framebuffer turned `degrees` clockwise onto it. */
function turnFrame(frame: DeviceScreenFrame, degrees: number): DeviceScreenFrame {
  let { origin, u, v } = frame
  // Each clockwise quarter: the framebuffer's x runs down the glass, its y leftwards.
  for (let turns = Math.round(degrees / 90) & 3; turns > 0; turns--) {
    ;[origin, u, v] = [origin.clone().add(v), v.clone().negate(), u]
  }
  return { origin, u, v, normal: frame.normal }
}

function paintMaterial(material: MeshBasicMaterial, texture: Texture | null): void {
  material.map = texture
  material.color.set(texture ? 0xffffff : 0x000000)
  material.needsUpdate = true
}

export function rigidBody(object: Object3D, pick: DeviceModelScreenPick, screenMeshName?: string, flipScreenV?: boolean): DeviceBody {
  const prepared = prepareDeviceModel(object, pick, screenMeshName, flipScreenV)
  const material = screenMaterial()
  prepared.screen.material = material
  // Exact once, from the vertices, before the stage turns anything.
  const bounds = new Box3().setFromObject(prepared.root, true)
  const frame = () => transformFrame(prepared.frame, prepared.root.matrixWorld)
  return {
    root: prepared.root,
    frame,
    point: (raycaster, clamp) => projectRayToScreen(raycaster.ray, frame(), clamp),
    paint: (texture) => paintMaterial(material, texture),
    bounds: () => bounds.clone(),
    turnOffset: () => 0,
    hinge: () => 0,
    step: () => false,
    fold: () => {},
    dispose: () => {},
  }
}

/**
 * How fast the 3D body's hinge turns toward where it is sent, from the guest or from a
 * drag: a short move at this rate, so it is as smooth as a long one. The renderer stands
 * a tent or a laptop at this rate too.
 */
export const HINGE_DEGREES_PER_SECOND = 45
/** The longest a move takes; a wider one turns faster to finish in this. */
export const HINGE_MAX_MOVE_MS = 1000

/**
 * A skinned foldable whose hinge is scrubbed along its baked `book_close` clip.
 *
 * Each pose is placed with the lit screen facing the camera — the closed cover, the
 * open inner panel, or the half-open one looked at along its fold — so the picture
 * stays readable without the user orbiting round to find it; the renderer stands a
 * tent or a laptop on the table from there. A fold eases the hinge and that placement
 * together.
 */
export function foldableBody(
  object: Object3D,
  clip: { start: number; duration: number },
  initial: DeviceModelFold,
): DeviceBody {
  const prepared = prepareFoldableModel(object)
  const materials = { cover: screenMaterial(), inner: screenMaterial() }
  prepared.cover.material = materials.cover
  prepared.inner.material = materials.inner
  const animation = object.animations[0]
  if (!animation) throw new Error('A foldable model needs its baked animation')
  const mixer = new AnimationMixer(object)
  mixer.clipAction(animation).play()

  let hinge = 180
  let panel: DeviceModelFold['panel'] = initial.panel
  let panelRotation = initial.panelRotation
  let picture: Texture | null = null
  let bounds: Box3 | null = null
  let lastPoint: NormalizedFramePoint | null = null
  let facing: DeviceModelFold['panel'] = initial.facing ?? initial.panel
  /**
   * The move under way. Hinge and placement travel together, linearly in time: the
   * leg lasts as long as the larger of the two turns takes at the set rate, capped so a
   * wide move speeds up. A new target, as a drag sends, starts a new leg from wherever
   * the body is, so the motion never jumps.
   */
  let leg: {
    from: number
    to: number
    start: number
    duration: number
    pose: { from: { quaternion: Quaternion; position: Vector3 }; to: { quaternion: Quaternion; position: Vector3 } }
  } | null = null

  const lit = (): Mesh => (panel === 'cover' ? prepared.cover : prepared.inner)
  const setHinge = (degrees: number) => {
    // A hair short of closed: a clip that ends the timeline would wrap back to open.
    mixer.setTime(clip.start + Math.min(1 - degrees / 180, 0.9999) * clip.duration)
    prepared.root.updateMatrixWorld(true)
    // Skinned raycasts test against bounds measured in one pose; re-measure in this one.
    for (const mesh of [prepared.cover, prepared.inner]) {
      if (!(mesh instanceof SkinnedMesh)) continue
      mesh.computeBoundingSphere()
      mesh.computeBoundingBox()
    }
  }
  const place = (pose: { quaternion: Quaternion; position: Vector3 }) => {
    prepared.root.quaternion.copy(pose.quaternion)
    prepared.root.position.copy(pose.position)
    prepared.root.updateMatrixWorld(true)
    bounds = null
  }
  const repaint = () => {
    if (picture) {
      picture.center.set(0.5, 0.5)
      // Texture rotation turns the lookup, so the picture turns the other way.
      picture.rotation = -(panelRotation * Math.PI) / 180
    }
    paintMaterial(materials[panel], picture)
    paintMaterial(materials[panel === 'cover' ? 'inner' : 'cover'], null)
  }

  const fold = (state: DeviceModelFold, animate: boolean) => {
    const target = Math.min(180, Math.max(0, state.hingeDegrees))
    panel = state.panel
    panelRotation = state.panelRotation
    facing = state.facing ?? state.panel
    repaint()
    lastPoint = null
    setHinge(target)
    const to = foldPose(prepared, facing === 'cover' ? prepared.cover : prepared.inner)
    const turn = (prepared.root.quaternion.angleTo(to.quaternion) * 180) / Math.PI
    const travel = Math.max(Math.abs(target - hinge), turn)
    if (!animate || travel < 1e-3) {
      leg = null
      hinge = target
      place(to)
      return
    }
    setHinge(hinge)
    leg = {
      from: hinge,
      to: target,
      start: performance.now(),
      duration: Math.min(HINGE_MAX_MOVE_MS, (travel / HINGE_DEGREES_PER_SECOND) * 1000),
      pose: { from: { quaternion: prepared.root.quaternion.clone(), position: prepared.root.position.clone() }, to },
    }
  }
  fold(initial, false)

  return {
    root: prepared.root,
    frame: () => turnFrame(fitScreenFrame(lit(), false)!, panelRotation),
    turnOffset: () => panelRotation,
    point(raycaster, clamp) {
      // Ray to UV rather than to a plane: half-open, the inner glass is two planes.
      const hit = raycaster.intersectObject(lit(), false)[0]
      if (hit?.uv) {
        // The UV is where on the glass as seen; the framebuffer lies turned under it.
        lastPoint = normalizeFramePoint({ left: 0, top: 0, width: 1, height: 1 }, hit.uv.x, 1 - hit.uv.y, panelRotation)
        return lastPoint
      }
      // A drag that slides off the glass stays where it left, as the flat view pins it.
      return clamp ? lastPoint : null
    },
    paint(texture) {
      picture = texture
      repaint()
    },
    bounds() {
      if (bounds) return bounds.clone()
      const toStage = prepared.root.parent ? prepared.root.parent.matrixWorld.clone().invert() : new Matrix4()
      const measured = new Box3()
      const point = new Vector3()
      for (const mesh of [prepared.cover, prepared.inner]) {
        const toLocal = new Matrix4().multiplyMatrices(toStage, mesh.matrixWorld)
        const position = mesh.geometry.getAttribute('position')
        for (let i = 0; i < position.count; i++) measured.expandByPoint(mesh.getVertexPosition(i, point).applyMatrix4(toLocal))
      }
      // The glass, not the body: a few percent covers the frame around it.
      bounds = measured.expandByScalar(measured.getSize(new Vector3()).length() * 0.02)
      return bounds.clone()
    },
    hinge: () => hinge,
    step(now) {
      if (!leg) return false
      const progress = Math.min(1, Math.max(0, (now - leg.start) / leg.duration))
      hinge = leg.from + (leg.to - leg.from) * progress
      setHinge(hinge)
      place({
        quaternion: leg.pose.from.quaternion.clone().slerp(leg.pose.to.quaternion, progress),
        position: leg.pose.from.position.clone().lerp(leg.pose.to.position, progress),
      })
      if (progress < 1) return true
      leg = null
      return false
    },
    fold,
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(object)
    },
  }
}
