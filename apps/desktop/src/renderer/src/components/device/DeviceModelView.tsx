import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Loader2, RotateCcw } from 'lucide-react'
import type { DeviceModelScreenPick } from '@superone/shared/device'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { disposeModel, parseModel, updateModelCameraClipPlanes } from '../coding/model-loader'
import { addModelFillLights, lightModel } from '../coding/model-environment'
import { rotateFrameDelta, type DeviceFrameProjector } from './device-input'
import { prepareDeviceModel, projectRayToScreen, transformFrame } from './device-model-scene'

export interface DeviceModelSource {
  object: Object3D
  screen: DeviceModelScreenPick
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

interface DeviceModelViewProps {
  /** `DeviceDescriptor.model`, e.g. "iPhone 17 Pro". */
  model: string
  /** The live picture; null until the device surface hands it over. */
  canvas: HTMLCanvasElement | null
  /** Called on every painted frame of `canvas`. */
  subscribeFrames: (listener: () => void) => () => void
  /** How far the device is lying over, as in the flat view. */
  rotationDegrees: number
  /** Whether a pointer on the glass is a touch; otherwise every drag orbits. */
  interactive: boolean
  /** Handed the glass mapping once the model is on screen, and null when it leaves. */
  onProjector: (projector: DeviceFrameProjector | null) => void
  /** The input pipeline's pointer handlers, bound where the pointer lands. */
  pointerHandlers?: React.DOMAttributes<HTMLDivElement>
  loadModel?: (model: string) => Promise<DeviceModelSource | null>
  children?: ReactNode
}

/** Shortest signed angle from `from` to `to`. */
function turnBetween(from: number, to: number): number {
  const delta = (to - from) % (Math.PI * 2)
  return delta > Math.PI ? delta - Math.PI * 2 : delta < -Math.PI ? delta + Math.PI * 2 : delta
}

/**
 * The device as its real 3D body, with the live picture on its glass.
 *
 * Draws only when something changes — a frame, a camera move, a turn — rather than
 * every display refresh: the same renderer decodes the stream, and an idle device
 * should cost nothing. Dragging the body orbits the camera; dragging the glass is a
 * touch, mapped through the camera onto the framebuffer.
 */
export function DeviceModelView({
  model,
  canvas,
  subscribeFrames,
  rotationDegrees,
  interactive,
  onProjector,
  pointerHandlers,
  loadModel = loadDesktopDeviceModel,
  children,
}: DeviceModelViewProps) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const sceneRef = useRef<{
    setPicture: (canvas: HTMLCanvasElement | null) => () => void
    turn: (degrees: number) => void
    reset: () => void
  } | null>(null)
  // Read by the scene without rebuilding it.
  const latest = useRef({ rotationDegrees, interactive, onProjector, subscribeFrames })
  latest.current = { rotationDegrees, interactive, onProjector, subscribeFrames }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let teardown: (() => void) | null = null
    setStatus('loading')

    void (async () => {
      const source = await loadModel(model)
      if (!source) throw new Error(`No 3D model for ${model}`)
      if (cancelled) { disposeModel(source.object); return }
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
      if (cancelled) {
        disposeEnvironment()
        renderer.dispose()
        disposeModel(prepared.root)
        return
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
      sceneRef.current = {
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
      }

      teardown = () => {
        cancelAnimationFrame(frameRequest)
        observer.disconnect()
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointermove', onPointerHover)
        controls.dispose()
        sceneRef.current = null
        latest.current.onProjector(null)
        disposeModel(prepared.root)
        disposeEnvironment()
        renderer.dispose()
        renderer.domElement.remove()
        host.style.cursor = ''
      }
      latest.current.onProjector(projector)
      setStatus('ready')
    })().catch(() => {
      if (!cancelled) setStatus('error')
    })

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [model, loadModel])

  useEffect(() => {
    if (status !== 'ready') return
    return sceneRef.current?.setPicture(canvas)
  }, [canvas, status])

  useEffect(() => {
    if (status === 'ready') sceneRef.current?.turn(rotationDegrees)
  }, [rotationDegrees, status])

  return (
    <div className="relative size-full min-h-0" data-testid="device-model-view">
      <div
        ref={hostRef}
        className={cn('size-full touch-none', status !== 'ready' && 'invisible')}
        {...pointerHandlers}
      >
        {children}
      </div>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
          {t('activity.device.modelFailed')}
        </div>
      )}
      {status === 'ready' && (
        <IconButton
          tooltip={t('activity.device.resetView')}
          className="absolute right-2 top-2"
          onClick={() => sceneRef.current?.reset()}
        >
          <RotateCcw />
        </IconButton>
      )}
    </div>
  )
}
