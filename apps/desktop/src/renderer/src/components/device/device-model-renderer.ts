import {
  CanvasTexture,
  Group,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import type { DeviceModelScreenPick, LoadedDeviceModel } from '@superone/shared/device'
import { iosSimulatorFoldForm } from '@superone/shared/ios-simulator'
import { disposeModel, parseModel, updateModelCameraClipPlanes } from '../coding/model-loader'
import { addModelFillLights, lightModel } from '../coding/model-environment'
import { rotateFrameDelta, type DeviceFrameProjector } from './device-input'
import { HINGE_DEGREES_PER_SECOND, foldableBody, rigidBody, type DeviceModelFold } from './device-model-body'
import { frameBounds, viewCorrection } from './device-model-framing'
import { attachDeviceModelTurntable } from './device-model-turntable'

export type { DeviceModelFold }

export interface DeviceModelSource {
  object: Object3D
  screen: DeviceModelScreenPick
  screenMeshName?: string
  flipScreenV?: boolean
  fold?: LoadedDeviceModel['fold']
  colors?: LoadedDeviceModel['colors']
}

/** What the scene reads on every use rather than rebuilding for. */
export interface DeviceModelInputs {
  rotationDegrees: number
  interactive: boolean
  subscribeFrames: (listener: () => void) => () => void
  /** A foldable's pose; null on a rigid body, and on a foldable not yet reported. */
  fold: DeviceModelFold | null
}

export interface MountedDeviceModel {
  setPicture: (canvas: HTMLCanvasElement | null) => () => void
  turn: (degrees: number) => void
  setFold: (fold: DeviceModelFold) => void
  reset: () => void
  projector: DeviceFrameProjector
  teardown: () => void
}

/** A local model for a simulator, through main, in `color` where it offers it. */
export async function loadDesktopDeviceModel(model: string, color?: string): Promise<DeviceModelSource | null> {
  const loaded = await window.app.loadDeviceModel(model, color)
  if (!loaded) return null
  const { archive } = loaded
  const bytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
  const { object } = await parseModel(`device.${loaded.format}`, bytes)
  return {
    object, screen: loaded.screen, screenMeshName: loaded.screenMeshName, flipScreenV: loaded.flipScreenV,
    fold: loaded.fold, colors: loaded.colors,
  }
}

type FoldForm = 'closed' | 'tent' | 'open' | 'laptop'

/** The form the angle belongs to. Which screen is lit does not pick it. */
function foldForm(fold: DeviceModelFold): FoldForm {
  return iosSimulatorFoldForm(fold.hingeDegrees)
}

/** How far above the base half a laptop is looked at, in degrees. */
const LAPTOP_ELEVATION = 15
/** How far round a tent's open end the camera stands, in degrees. */
const TENT_SIDE = 18
/** A tent's stance grows in over its first degrees of opening, so closing settles flat. */
const TENT_FULL_AT = 30

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const aboutAxis = (axis: Vector3, degrees: number) => new Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180)

/**
 * The tilt, in view space, that stands a foldable on the table in its form.
 *
 * The stage has turned the hinge level: across for a laptop, along the top for a tent.
 * A laptop's body is posed looking along its fold's bisector, so each half leans
 * `90 - hinge / 2` off the view plane; tipping the lower half toward the camera until
 * it sits `LAPTOP_ELEVATION` under the eye line lays it on the table. A tent's cover
 * faces the camera; leaning it back by half the hinge stands both halves' edges on
 * the table, and the camera then steps round towards its open right end at eye level,
 * so the halves are seen parting as a tent on a desk is.
 */
function foldTilt(form: FoldForm, hingeDegrees: number): Quaternion {
  if (form === 'laptop') return aboutAxis(X_AXIS, LAPTOP_ELEVATION - hingeDegrees / 2)
  if (form !== 'tent') return new Quaternion()
  return aboutAxis(Y_AXIS, -TENT_SIDE * Math.min(1, hingeDegrees / TENT_FULL_AT))
    .multiply(aboutAxis(X_AXIS, -hingeDegrees / 2))
}

/** The hinge's rate, for the tilt that stands a foldable in its form. */
const TILT_RADIANS_PER_MS = (HINGE_DEGREES_PER_SECOND * Math.PI) / 180 / 1000

/** The same turn the flat view animates with CSS. */
const TURN_MS = 300
/** Air around the device when the camera frames it. */
const FIT_MARGIN = 1.12
const FOV = 30
const ORIGIN = new Vector3()
const IDENTITY_QUATERNION = new Quaternion()

/** Shortest signed angle from `from` to `to`. */
function turnBetween(from: number, to: number): number {
  const delta = (to - from) % (Math.PI * 2)
  return delta > Math.PI ? delta - Math.PI * 2 : delta < -Math.PI ? delta + Math.PI * 2 : delta
}

/**
 * Builds the scene into `host`, or disposes everything and returns null once
 * `isCancelled` reports the view has moved on.
 */
export async function mountDeviceModel(
  host: HTMLElement,
  source: DeviceModelSource,
  latest: { readonly current: DeviceModelInputs },
  isCancelled: () => boolean,
): Promise<MountedDeviceModel | null> {
  if (isCancelled()) { disposeModel(source.object); return null }
  // A foldable not yet reported is drawn open, which is how Apple models it at rest.
  const initialFold = latest.current.fold ?? { hingeDegrees: 180, panel: 'inner', panelRotation: 0, laptop: false }
  const body = source.fold
    ? foldableBody(source.object, source.fold, initialFold)
    : rigidBody(source.object, source.screen, source.screenMeshName, source.flipScreenV)
  let form = foldForm(initialFold)
  // Turned about the view axis for orientation, separately from the model's own
  // upright placement.
  const stage = new Group()
  stage.add(body.root)
  // Turned once the stage has levelled the hinge, so the device stands on the table in
  // its form. Outside the stage, so it follows no device turn.
  const tilt = new Group()
  tilt.add(stage)
  tilt.quaternion.copy(foldTilt(form, initialFold.hingeDegrees))
  // Identity except for the one turn after a drag. Under the user's orbit, so that
  // orbit stays put when the hinge moves inside one form.
  const align = new Group()
  align.add(tilt)
  // Turned by the user's drag, around the stage's orientation turn: the camera stays put.
  const view = new Group()
  view.add(align)
  const scene = new Scene()
  scene.add(view)

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = SRGBColorSpace
  const disposeEnvironment = await import('../coding/apple-usdz-environment')
    .then(({ lightAppleUsdModel }) => lightAppleUsdModel(scene, renderer))
    .catch(() => {
      addModelFillLights(scene)
      return lightModel(scene, renderer)
    })
  if (isCancelled()) {
    disposeEnvironment()
    renderer.dispose()
    body.dispose()
    disposeModel(body.root)
    return null
  }
  renderer.domElement.className = 'block size-full'
  host.prepend(renderer.domElement)

  const camera = new PerspectiveCamera(FOV, 1, 0.001, 100)
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let frameRequest = 0
  // Where the camera stood when the turn began, before the user's zoom.
  let turn: { from: number; to: number; start: number; distance: number; aim: Vector3 } | null = null
  // When the tilt last stepped toward the form's stance; null while it stands there.
  let tippedAt: number | null = null
  // The user's own turn easing back to face on, from where it was and how far zoomed.
  let settle: { from: Quaternion; zoom: number; start: number } | null = null
  // The camera's framing distance as last drawn, before the user's zoom; 0 until then.
  let framed = 0
  // Where that frame was aimed, so a turn eases the aim as well as the distance.
  const framedAim = new Vector3()
  // A drag holds the pose, the tilt, and the stage. The framing distance still follows.
  let holding = false
  // One rigid correction from the pose a drag held to that form's view.
  let orient: {
    fromPosition: Vector3
    fromQuaternion: Quaternion
    zoomFrom: number
    zoomTo: number
    start: number
  } | null = null
  // The glass a release turned toward, so a later republish of that stance does not turn again.
  let releaseAimed: 'cover' | 'inner' | null = null
  // Zoom a paused release turn was showing. Null while the turntable's own zoom is on screen.
  let heldZoom: number | null = null
  // View orientation last drawn, so a zoom wheel is not mistaken for a turn of the body.
  const viewed = new Quaternion()
  const requestRender = () => { if (!frameRequest) frameRequest = requestAnimationFrame(draw) }

  const zeroAlign = () => {
    align.position.set(0, 0, 0)
    align.quaternion.identity()
    align.scale.set(1, 1, 1)
  }
  const clearOrient = () => {
    orient = null
    zeroAlign()
    align.updateMatrixWorld(true)
  }
  // Leave the correction where it is on screen and drop its clock. A new drag pins that pose.
  const freezeOrient = () => {
    if (!orient) return
    const progress = Math.min(1, (performance.now() - orient.start) / TURN_MS)
    const eased = 1 - (1 - progress) ** 3
    align.position.lerpVectors(orient.fromPosition, ORIGIN, eased)
    align.quaternion.slerpQuaternions(orient.fromQuaternion, IDENTITY_QUATERNION, eased)
    heldZoom = orient.zoomFrom + (orient.zoomTo - orient.zoomFrom) * eased
    orient = null
    align.updateMatrixWorld(true)
  }

  // Measured in the stage's own space. A turn under way is fitted where it is headed.
  // The one-shot correction is included; the user's orbit is not, so turning the body
  // by hand never dollies. A centered body matches the old size fit.
  const bodyBounds = () => body.bounds().applyMatrix4(stage.matrixWorld)
  const fittedBounds = () => {
    tilt.updateMatrix()
    align.updateMatrix()
    const turned = new Matrix4().makeRotationZ(turn ? turn.from + turn.to : stage.rotation.z)
    turned.premultiply(tilt.matrix).premultiply(align.matrix)
    return body.bounds().applyMatrix4(turned)
  }
  const bodyRadius = () => body.bounds().getBoundingSphere(new Sphere()).radius

  // The view sits at the origin, so its quaternion carries the fit into the world.
  // The camera still looks along −Z: recentering is a slide, not a turn.
  const placeFrame = () => {
    const fit = frameBounds(fittedBounds(), camera.fov, camera.aspect, FIT_MARGIN)
    fit.target.applyQuaternion(view.quaternion)
    return fit
  }
  /**
   * The camera looks along −Z. It slides so the body stays centered, and its distance
   * fits that centered size — a shift off the origin does not, by itself, pull it back.
   * A turn eases from where the camera stood by the turn's own curve.
   */
  const frameCamera = (turnEased: number, zoom: number) => {
    const fit = placeFrame()
    if (turn) {
      framed = turn.distance + (fit.distance - turn.distance) * turnEased
      framedAim.lerpVectors(turn.aim, fit.target, turnEased)
    } else {
      framed = fit.distance
      framedAim.copy(fit.target)
    }
    camera.position.set(framedAim.x, framedAim.y, framedAim.z + Math.max(framed, 1e-3) * zoom)
    camera.lookAt(framedAim)
  }

  const hitsGlass = (event: PointerEvent) =>
    latest.current.interactive && projector.point(event.clientX, event.clientY, false) !== null
  const onPointerHover = (event: PointerEvent) => {
    if (event.buttons !== 0) return
    host.style.cursor = hitsGlass(event) ? '' : 'grab'
  }
  renderer.domElement.addEventListener('pointermove', onPointerHover)
  // A press on the glass is a touch; anywhere else it turns the body.
  const turntable = attachDeviceModelTurntable(renderer.domElement, view, {
    canStart: (event) => !hitsGlass(event),
    // A drag takes the body from wherever an easing back has got it to. Turning the
    // body drops a release's correction; a wheel only changes zoom.
    onChange: () => {
      settle = null
      heldZoom = null
      if (view.quaternion.angleTo(viewed) > 1e-4) clearOrient()
      requestRender()
    },
  })

  const projector: DeviceFrameProjector = {
    element: host,
    point(clientX, clientY, clamp) {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      return body.point(raycaster, clamp)
    },
    delta: (deltaX, deltaY) => rotateFrameDelta(deltaX, deltaY, latest.current.rotationDegrees),
    size() {
      const rect = renderer.domElement.getBoundingClientRect()
      const frame = body.frame()
      const toPixels = (point: Vector3) => {
        const ndc = point.clone().project(camera)
        return new Vector2((ndc.x + 1) * rect.width / 2, (1 - ndc.y) * rect.height / 2)
      }
      const origin = toPixels(frame.origin)
      return {
        width: toPixels(frame.origin.clone().add(frame.u)).distanceTo(origin),
        height: toPixels(frame.origin.clone().add(frame.v)).distanceTo(origin),
      }
    },
  }

  function draw(now: number) {
    frameRequest = 0
    let turnEased = 1
    if (turn && !holding) {
      const progress = Math.min(1, (now - turn.start) / TURN_MS)
      turnEased = 1 - (1 - progress) ** 3
      stage.rotation.z = turn.from + turn.to * turnEased
      stage.updateMatrixWorld(true)
      if (progress < 1) requestRender()
      else turn = null
    }
    let moving = body.step(now)
    // The form's stance follows whatever angle the hinge has reached; a change of form
    // turns toward its stance at the hinge's own rate. A drag holds the stance it began
    // in. A released drag has already snapped there and turns once, as `orient`.
    if (!holding && !orient) {
      const stance = foldTilt(form, body.hinge())
      if (!tilt.quaternion.equals(stance)) {
        tilt.quaternion.rotateTowards(stance, TILT_RADIANS_PER_MS * (now - (tippedAt ?? now)))
        tilt.updateMatrixWorld(true)
        tippedAt = tilt.quaternion.angleTo(stance) < 1e-6 ? null : now
        moving ||= tippedAt !== null
      }
    }
    let zoom = heldZoom ?? turntable.zoom()
    if (!holding && settle && !orient) {
      const progress = Math.min(1, (now - settle.start) / TURN_MS)
      const eased = 1 - (1 - progress) ** 3
      view.quaternion.slerpQuaternions(settle.from, new Quaternion(), eased)
      view.updateMatrixWorld(true)
      zoom = settle.zoom + (zoom - settle.zoom) * eased
      if (progress < 1) moving = true
      else settle = null
    }
    if (orient && !holding) {
      const progress = Math.min(1, (now - orient.start) / TURN_MS)
      const eased = 1 - (1 - progress) ** 3
      align.position.lerpVectors(orient.fromPosition, ORIGIN, eased)
      align.quaternion.slerpQuaternions(orient.fromQuaternion, IDENTITY_QUATERNION, eased)
      align.updateMatrixWorld(true)
      zoom = orient.zoomFrom + (orient.zoomTo - orient.zoomFrom) * eased
      if (progress < 1) moving = true
      else clearOrient()
    }
    if (moving) requestRender()
    viewed.copy(view.quaternion)
    frameCamera(turnEased, zoom)
    updateModelCameraClipPlanes(camera, bodyBounds(), bodyRadius())
    renderer.render(scene, camera)
  }

  // Resizing clears the drawing buffer, and a ResizeObserver runs after this frame's
  // animation callbacks: a render merely requested would leave the frame being painted
  // blank, so dragging a panel's edge flickered. Drawn now, it lands in the same frame.
  const resize = () => {
    const { width, height } = host.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    cancelAnimationFrame(frameRequest)
    draw(performance.now())
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  /** Back to face on, eased by the turn's own curve. */
  const reset = () => {
    const from = view.quaternion.clone()
    const zoom = turntable.zoom()
    turntable.reset()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!(reduced || (from.angleTo(view.quaternion) < 1e-6 && zoom === 1))) {
      view.quaternion.copy(from)
      settle = { from, zoom, start: performance.now() }
    }
    viewed.copy(view.quaternion)
    requestRender()
  }
  // The glass's own mapping may already show part of the turn; the stage does the rest.
  const stageTurn = (degrees: number) => -((degrees - body.turnOffset()) * Math.PI) / 180
  stage.rotation.z = stageTurn(latest.current.rotationDegrees)
  stage.updateMatrixWorld(true)
  resize()

  function turnTo(degrees: number) {
    const target = stageTurn(degrees)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const delta = turnBetween(stage.rotation.z, target)
    // No angle to turn: drop a turn the effect just armed and let the fit follow live.
    if (reduced || Math.abs(delta) < 1e-4) {
      turn = null
      stage.rotation.z = target
      stage.updateMatrixWorld(true)
      requestRender()
      return
    }
    // Read before the new turn is set: until first drawn, the old target's fit stands in.
    const fit = placeFrame()
    const distance = framed || fit.distance
    const aim = framed ? framedAim.clone() : fit.target.clone()
    turn = { from: stage.rotation.z, to: delta, start: performance.now(), distance, aim }
    requestRender()
  }

  /** The stage angle `fold` lands on, once its panel offset is the one in the fold. */
  const stageTarget = (fold: DeviceModelFold) =>
    -((latest.current.rotationDegrees - fold.panelRotation) * Math.PI) / 180

  const sameReleasedView = (fold: DeviceModelFold) =>
    foldForm(fold) === form
    && Math.abs(fold.hingeDegrees - body.hinge()) <= 0.5
    && (fold.facing ?? fold.panel) === releaseAimed
    && Math.abs(turnBetween(stage.rotation.z, stageTarget(fold))) < 1e-3

  /**
   * After a drag, one short turn from the pose being shown to the form's final view:
   * the pose, the tilt, and the stage already at their ends. A new form, or a return
   * to face that the drag interrupted, is included. The camera's distance follows the
   * swing so the phone does not clip, and lands on the form's fit.
   */
  function releaseToForm(fold: DeviceModelFold) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    view.updateMatrixWorld(true)
    const seen = body.root.matrixWorld.clone()
    let zoomFrom = heldZoom ?? turntable.zoom()
    if (orient) {
      const progress = Math.min(1, (performance.now() - orient.start) / TURN_MS)
      const eased = 1 - (1 - progress) ** 3
      zoomFrom = orient.zoomFrom + (orient.zoomTo - orient.zoomFrom) * eased
    }
    heldZoom = null
    const faceOn = foldForm(fold) !== form || settle !== null
    settle = null
    orient = null
    zeroAlign()
    // Snap the orbit. The scene reset eases it on its own clock; this turn includes it.
    if (faceOn) turntable.reset()
    viewed.copy(view.quaternion)
    form = foldForm(fold)
    body.fold(fold, false)
    tilt.quaternion.copy(foldTilt(form, body.hinge()))
    turn = null
    stage.rotation.z = stageTurn(latest.current.rotationDegrees)
    view.updateMatrixWorld(true)
    const arrived = body.root.matrixWorld.clone()
    const correction = viewCorrection(seen, arrived, view.matrixWorld)
    correction.decompose(align.position, align.quaternion, align.scale)
    align.scale.set(1, 1, 1)
    align.updateMatrixWorld(true)
    releaseAimed = fold.facing ?? fold.panel
    const zoomTo = faceOn ? 1 : zoomFrom
    const moving = align.position.lengthSq() > 1e-10
      || align.quaternion.angleTo(IDENTITY_QUATERNION) > 1e-4
      || Math.abs(zoomFrom - zoomTo) > 1e-4
    if (reduced || !moving) {
      clearOrient()
      requestRender()
      return
    }
    orient = {
      fromPosition: align.position.clone(),
      fromQuaternion: align.quaternion.clone(),
      zoomFrom,
      zoomTo,
      start: performance.now(),
    }
    requestRender()
  }

  let texture: CanvasTexture | null = null
  return {
    setPicture(picture) {
      const upload = () => {
        if (!picture || picture.width === 0 || picture.height === 0) return
        // A new size needs new texture storage; the old one cannot be resized.
        if (texture && (texture.image.width !== texture.userData.width || texture.image.height !== texture.userData.height)) {
          texture.dispose()
          texture = null
        }
        if (!texture) {
          texture = new CanvasTexture(picture)
          texture.colorSpace = SRGBColorSpace
          texture.generateMipmaps = false
          texture.minFilter = LinearFilter
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
          body.paint(texture)
        }
        texture.userData = { width: picture.width, height: picture.height }
        texture.needsUpdate = true
        requestRender()
      }
      upload()
      const unsubscribe = picture ? latest.current.subscribeFrames(upload) : () => {}
      return () => {
        unsubscribe()
        texture?.dispose()
        texture = null
        body.paint(null)
        requestRender()
      }
    },
    turn: turnTo,
    setFold(fold) {
      // A drag scrubs the clip and leaves the half without the cover where it stands:
      // no pose, no tilt, no stage turn, no camera angle. The frame slides to keep the
      // body centered, and the distance changes only to fit that size. Letting go turns
      // once, by the smallest angle, to that form.
      if (fold.hold) {
        if (!holding) {
          holding = true
          turn = null
          freezeOrient()
          tippedAt = null
        }
        body.scrub(fold.hingeDegrees)
        requestRender()
        return
      }
      if (holding) {
        holding = false
        releaseToForm(fold)
        return
      }
      // The guest catching up republishes the stance this release is already turning to.
      // A real change of stance retargets the same one turn instead of starting another.
      if (orient && sameReleasedView(fold)) {
        turn = null
        body.fold(fold, false)
        return
      }
      if (orient || heldZoom !== null) {
        releaseToForm(fold)
        return
      }
      holding = false
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      // A new form is a new way of holding the device; start it facing the camera,
      // as the guest starts it upright. A hinge move within one keeps the user's view.
      const next = foldForm(fold)
      if (next !== form) reset()
      form = next
      body.fold(fold, !reduced)
      if (reduced) {
        tilt.quaternion.copy(foldTilt(form, fold.hingeDegrees))
        tilt.updateMatrixWorld(true)
      }
      // The lit panel's offset may have changed under an unchanged device turn.
      turnTo(latest.current.rotationDegrees)
      requestRender()
    },
    reset,
    projector,
    teardown() {
      cancelAnimationFrame(frameRequest)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerHover)
      turntable.dispose()
      body.dispose()
      disposeModel(body.root)
      disposeEnvironment()
      renderer.dispose()
      renderer.domElement.remove()
      host.style.cursor = ''
    },
  }
}
