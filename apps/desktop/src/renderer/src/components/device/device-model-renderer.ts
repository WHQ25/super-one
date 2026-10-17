import {
  CanvasTexture,
  Group,
  LinearFilter,
  PerspectiveCamera,
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
import { foldableBody, rigidBody, type DeviceModelFold } from './device-model-body'
import { attachDeviceModelTurntable } from './device-model-turntable'

export type { DeviceModelFold }

export interface DeviceModelSource {
  object: Object3D
  screen: DeviceModelScreenPick
  screenMeshName?: string
  flipScreenV?: boolean
  fold?: LoadedDeviceModel['fold']
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

/** A local model for a simulator, through main. */
export async function loadDesktopDeviceModel(model: string): Promise<DeviceModelSource | null> {
  const loaded = await window.app.loadDeviceModel(model)
  if (!loaded) return null
  const { archive } = loaded
  const bytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
  const { object } = await parseModel(`device.${loaded.format}`, bytes)
  return { object, screen: loaded.screen, screenMeshName: loaded.screenMeshName, flipScreenV: loaded.flipScreenV, fold: loaded.fold }
}

/** Closed, standing as a tent, or open: a foldable's forms, by the panel it lights. */
function foldForm(fold: DeviceModelFold): 'closed' | 'tent' | 'open' {
  return fold.panel === 'inner' ? 'open' : fold.hingeDegrees > 0 ? 'tent' : 'closed'
}

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
  const initialFold = latest.current.fold ?? { hingeDegrees: 180, panel: 'inner', panelRotation: 0 }
  const body = source.fold
    ? foldableBody(source.object, source.fold, initialFold)
    : rigidBody(source.object, source.screen, source.screenMeshName, source.flipScreenV)
  let form = foldForm(initialFold)
  // Turned about the view axis for orientation, separately from the model's own
  // upright placement.
  const stage = new Group()
  stage.add(body.root)
  // Turned by the user's drag, around the stage's orientation turn: the camera stays put.
  const view = new Group()
  view.add(stage)
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
  // Measured in the stage's own space, so only the turn is applied here; a turned
  // box's corners are exact at the quarter turns the camera is fitted at. Framing
  // leaves out the user's own turn, so a drag never moves the camera in or out.
  const bodyBounds = () => body.bounds().applyMatrix4(stage.matrixWorld)
  const fittedBounds = () => body.bounds().applyMatrix4(stage.matrix)
  const bodyRadius = () => body.bounds().getBoundingSphere(new Sphere()).radius

  let frameRequest = 0
  let turn: { from: number; to: number; start: number } | null = null
  let folding = false
  const requestRender = () => { if (!frameRequest) frameRequest = requestAnimationFrame(draw) }

  const fitDistance = () => {
    const size = fittedBounds().getSize(new Vector3())
    const vertical = Math.tan((camera.fov * Math.PI) / 360)
    const horizontal = vertical * camera.aspect
    return Math.max(size.y / 2 / vertical, size.x / 2 / horizontal) * FIT_MARGIN + size.z / 2
  }
  /** The camera looks straight at the body; only the framing distance changes. */
  const refit = () => {
    camera.position.set(0, 0, fitDistance() * turntable.zoom())
    camera.lookAt(0, 0, 0)
    requestRender()
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
    onChange: refit,
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
    if (turn) {
      const progress = Math.min(1, (now - turn.start) / TURN_MS)
      const eased = 1 - (1 - progress) ** 3
      stage.rotation.z = turn.from + turn.to * eased
      stage.updateMatrixWorld(true)
      if (progress < 1) requestRender()
      else { turn = null; refit() }
    }
    if (body.step(now)) {
      folding = true
      requestRender()
    } else if (folding) {
      folding = false
      refit()
    }
    updateModelCameraClipPlanes(camera, bodyBounds(), bodyRadius())
    renderer.render(scene, camera)
  }

  const resize = () => {
    const { width, height } = host.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    refit()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  const reset = () => turntable.reset()
  // The glass's own mapping may already show part of the turn; the stage does the rest.
  const stageTurn = (degrees: number) => -((degrees - body.turnOffset()) * Math.PI) / 180
  stage.rotation.z = stageTurn(latest.current.rotationDegrees)
  stage.updateMatrixWorld(true)
  reset()
  resize()

  function turnTo(degrees: number) {
    const target = stageTurn(degrees)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      stage.rotation.z = target
      stage.updateMatrixWorld(true)
      refit()
      return
    }
    turn = { from: stage.rotation.z, to: turnBetween(stage.rotation.z, target), start: performance.now() }
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
      if (next !== form) turntable.reset()
      form = next
      body.fold(fold, !reduced)
      // The lit panel's offset may have changed under an unchanged device turn.
      turnTo(latest.current.rotationDegrees)
      if (reduced) refit()
      else requestRender()
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
