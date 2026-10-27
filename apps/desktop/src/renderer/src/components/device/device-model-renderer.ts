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
import { disposeModel, parseModel, updateModelCameraClipPlanes } from '../coding/model-loader'
import { addModelFillLights, lightModel } from '../coding/model-environment'
import { rotateFrameDelta, type DeviceFrameProjector } from './device-input'
import { HINGE_DEGREES_PER_SECOND, foldableBody, rigidBody, type DeviceModelFold } from './device-model-body'
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

/** Closed, standing as a tent, open, or laid as a laptop, by the screen turned to the camera. */
function foldForm(fold: DeviceModelFold): FoldForm {
  if (fold.laptop) return 'laptop'
  return (fold.facing ?? fold.panel) === 'inner' ? 'open' : fold.hingeDegrees > 0 ? 'tent' : 'closed'
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
  // Turned by the user's drag, around the stage's orientation turn: the camera stays put.
  const view = new Group()
  view.add(tilt)
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
  // `distance` is where the camera stood when the turn began, before the user's zoom.
  let turn: { from: number; to: number; start: number; distance: number } | null = null
  // When the tilt last stepped toward the form's stance; null while it stands there.
  let tippedAt: number | null = null
  // The user's own turn easing back to face on, from where it was and how far zoomed.
  let settle: { from: Quaternion; zoom: number; start: number } | null = null
  // The camera's framing distance as last drawn, before the user's zoom; 0 until then.
  let framed = 0
  const requestRender = () => { if (!frameRequest) frameRequest = requestAnimationFrame(draw) }

  // Measured in the stage's own space, so only the turn is applied here; a turned
  // box's corners are exact at the quarter turns the camera is fitted at, so a turn
  // under way is fitted where it is headed. Framing leaves out the user's own turn,
  // so a drag never moves the camera in or out.
  const bodyBounds = () => body.bounds().applyMatrix4(stage.matrixWorld)
  const fittedBounds = () => {
    const turned = new Matrix4().makeRotationZ(turn ? turn.from + turn.to : stage.rotation.z)
    return body.bounds().applyMatrix4(turned.premultiply(tilt.matrix))
  }
  const bodyRadius = () => body.bounds().getBoundingSphere(new Sphere()).radius

  const fitDistance = () => {
    const size = fittedBounds().getSize(new Vector3())
    const vertical = Math.tan((camera.fov * Math.PI) / 360)
    const horizontal = vertical * camera.aspect
    return Math.max(size.y / 2 / vertical, size.x / 2 / horizontal) * FIT_MARGIN + size.z / 2
  }
  /**
   * The camera looks straight at the body; only the framing distance changes. Fitted
   * on every frame, so a fold reframes as it bends rather than jumping once it settles,
   * and a turn eases from where the camera stood by the turn's own curve.
   */
  const frameCamera = (turnEased: number, zoom: number) => {
    const fit = fitDistance()
    framed = turn ? turn.distance + (fit - turn.distance) * turnEased : fit
    camera.position.set(0, 0, framed * zoom)
    camera.lookAt(0, 0, 0)
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
    // A drag takes the body from wherever an easing back has got it to.
    onChange: () => { settle = null; requestRender() },
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
    if (turn) {
      const progress = Math.min(1, (now - turn.start) / TURN_MS)
      turnEased = 1 - (1 - progress) ** 3
      stage.rotation.z = turn.from + turn.to * turnEased
      stage.updateMatrixWorld(true)
      if (progress < 1) requestRender()
      else turn = null
    }
    let moving = body.step(now)
    // The form's stance follows whatever angle the hinge has reached; a change of form
    // turns toward its stance at the hinge's own rate.
    const stance = foldTilt(form, body.hinge())
    if (!tilt.quaternion.equals(stance)) {
      tilt.quaternion.rotateTowards(stance, TILT_RADIANS_PER_MS * (now - (tippedAt ?? now)))
      tilt.updateMatrixWorld(true)
      tippedAt = tilt.quaternion.angleTo(stance) < 1e-6 ? null : now
      moving ||= tippedAt !== null
    }
    let zoom = turntable.zoom()
    if (settle) {
      const progress = Math.min(1, (now - settle.start) / TURN_MS)
      const eased = 1 - (1 - progress) ** 3
      view.quaternion.slerpQuaternions(settle.from, new Quaternion(), eased)
      view.updateMatrixWorld(true)
      zoom = settle.zoom + (zoom - settle.zoom) * eased
      if (progress < 1) moving = true
      else settle = null
    }
    if (moving) requestRender()
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
    if (reduced || (from.angleTo(view.quaternion) < 1e-6 && zoom === 1)) return
    view.quaternion.copy(from)
    settle = { from, zoom, start: performance.now() }
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
    if (reduced) {
      stage.rotation.z = target
      stage.updateMatrixWorld(true)
      requestRender()
      return
    }
    // Read before the new turn is set: until first drawn, the old target's fit stands in.
    const distance = framed || fitDistance()
    turn = { from: stage.rotation.z, to: turnBetween(stage.rotation.z, target), start: performance.now(), distance }
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
