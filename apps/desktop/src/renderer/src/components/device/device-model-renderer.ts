import {
  Box3,
  CanvasTexture,
  Group,
  LinearFilter,
  MeshBasicMaterial,
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
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { DeviceModelScreenPick } from '@superone/shared/device'
import { disposeModel, parseModel, updateModelCameraClipPlanes } from '../coding/model-loader'
import { addModelFillLights, lightModel } from '../coding/model-environment'
import { rotateFrameDelta, type DeviceFrameProjector } from './device-input'
import { prepareDeviceModel, projectRayToScreen, transformFrame } from './device-model-scene'

export interface DeviceModelSource {
  object: Object3D
  screen: DeviceModelScreenPick
}

/** What the scene reads on every use rather than rebuilding for. */
export interface DeviceModelInputs {
  rotationDegrees: number
  interactive: boolean
  subscribeFrames: (listener: () => void) => () => void
}

export interface MountedDeviceModel {
  setPicture: (canvas: HTMLCanvasElement | null) => () => void
  turn: (degrees: number) => void
  reset: () => void
  projector: DeviceFrameProjector
  teardown: () => void
}

/** Apple's composed model for a simulator model, through main. */
export async function loadDesktopDeviceModel(model: string): Promise<DeviceModelSource | null> {
  const loaded = await window.app.loadDeviceModel(model)
  if (!loaded) return null
  const { archive } = loaded
  const bytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
  const { object } = await parseModel('device.usdz', bytes)
  return { object, screen: loaded.screen }
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
  const prepared = prepareDeviceModel(source.object, source.screen)

  const screenMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false })
  prepared.screen.material = screenMaterial
  // Turned about the view axis for orientation, separately from the model's own
  // upright placement.
  const stage = new Group()
  stage.add(prepared.root)
  const scene = new Scene()
  scene.add(stage)

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
    disposeModel(prepared.root)
    return null
  }
  renderer.domElement.className = 'block size-full'
  host.prepend(renderer.domElement)

  const camera = new PerspectiveCamera(FOV, 1, 0.001, 100)
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const glassFrame = () => transformFrame(prepared.frame, prepared.root.matrixWorld)
  // Exact once, from the vertices; after that only the stage turns, and a turned
  // box's corners are exact at the quarter turns the camera is fitted at.
  const localBounds = new Box3().setFromObject(prepared.root, true)
  const radius = localBounds.getBoundingSphere(new Sphere()).radius
  const bodyBounds = () => localBounds.clone().applyMatrix4(stage.matrixWorld)

  let frameRequest = 0
  let turn: { from: number; to: number; start: number } | null = null
  const requestRender = () => { if (!frameRequest) frameRequest = requestAnimationFrame(draw) }

  const fitDistance = () => {
    const size = bodyBounds().getSize(new Vector3())
    const vertical = Math.tan((camera.fov * Math.PI) / 360)
    const horizontal = vertical * camera.aspect
    return Math.max(size.y / 2 / vertical, size.x / 2 / horizontal) * FIT_MARGIN + size.z / 2
  }
  /** Keep the direction the user orbited to; only the framing distance changes. */
  const refit = () => {
    const direction = camera.position.clone().sub(controls.target)
    if (direction.lengthSq() === 0) direction.set(0, 0, 1)
    camera.position.copy(controls.target).addScaledVector(direction.normalize(), fitDistance())
    controls.update()
    requestRender()
  }

  // Registered before OrbitControls so it decides first whether a press orbits.
  const hitsGlass = (event: PointerEvent) =>
    latest.current.interactive && projector.point(event.clientX, event.clientY, false) !== null
  const onPointerDown = (event: PointerEvent) => { controls.enabled = !hitsGlass(event) }
  const onPointerHover = (event: PointerEvent) => {
    if (event.buttons !== 0) return
    host.style.cursor = hitsGlass(event) ? '' : 'grab'
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerHover)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.target.set(0, 0, 0)
  controls.addEventListener('change', requestRender)

  const projector: DeviceFrameProjector = {
    element: host,
    point(clientX, clientY, clamp) {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      return projectRayToScreen(raycaster.ray, glassFrame(), clamp)
    },
    delta: (deltaX, deltaY) => rotateFrameDelta(deltaX, deltaY, latest.current.rotationDegrees),
    size() {
      const rect = renderer.domElement.getBoundingClientRect()
      const frame = glassFrame()
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
    const moving = controls.update()
    updateModelCameraClipPlanes(camera, bodyBounds(), radius)
    renderer.render(scene, camera)
    if (moving) requestRender()
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

  const reset = () => {
    camera.position.set(0, 0, 1)
    controls.target.set(0, 0, 0)
    refit()
  }
  stage.rotation.z = -(latest.current.rotationDegrees * Math.PI) / 180
  stage.updateMatrixWorld(true)
  reset()
  resize()

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
          screenMaterial.map = texture
          screenMaterial.color.set(0xffffff)
          screenMaterial.needsUpdate = true
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
        screenMaterial.map = null
        screenMaterial.color.set(0x000000)
        screenMaterial.needsUpdate = true
        requestRender()
      }
    },
    turn(degrees) {
      const target = -(degrees * Math.PI) / 180
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        stage.rotation.z = target
        stage.updateMatrixWorld(true)
        refit()
        return
      }
      turn = { from: stage.rotation.z, to: turnBetween(stage.rotation.z, target), start: performance.now() }
      requestRender()
    },
    reset,
    projector,
    teardown() {
      cancelAnimationFrame(frameRequest)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerHover)
      controls.dispose()
      disposeModel(prepared.root)
      disposeEnvironment()
      renderer.dispose()
      renderer.domElement.remove()
      host.style.cursor = ''
    },
  }
}
