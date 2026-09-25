import {
  AnimationMixer, Box3, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Material, type Object3D, type Texture,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { parseModel, placeModelCamera, updateModelCameraClipPlanes } from '../../desktop/src/renderer/src/components/coding/model-loader'
import { addModelFillLights, lightModel } from '../../desktop/src/renderer/src/components/coding/model-environment'

declare global {
  interface Window { modelPreviewTarget: { name: string; uri: string } }
}

function disposeModel(object: Object3D): void {
  object.traverse((part) => {
    if (!('geometry' in part)) return
    const mesh = part as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] }
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) (value as Texture).dispose()
      }
      material.dispose()
    }
  })
}

function status(message: string): void {
  document.getElementById('status')!.textContent = message
}

async function main(): Promise<void> {
  const { name, uri } = window.modelPreviewTarget
  const host = document.getElementById('stage')!
  const response = await fetch(uri)
  if (!response.ok && response.status !== 0) throw new Error(`Could not read model (${response.status})`)
  const bytes = await response.arrayBuffer()
  // Only the transferred file is available on the phone. Reject glTF sibling
  // requests instead of allowing a model to read other cached previews.
  const loaded = await parseModel(name, bytes)
  const bounds = new Box3().setFromObject(loaded.object)
  if (bounds.isEmpty()) { disposeModel(loaded.object); throw new Error('No visible geometry in model') }
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const radius = Math.max(size.length() / 2, 0.01)
  const scene = new Scene()
  addModelFillLights(scene)
  scene.add(loaded.object)
  const camera = new PerspectiveCamera(45, 1, 0.001, Math.max(1000, radius * 100))
  const initialRect = host.getBoundingClientRect()
  if (initialRect.width > 0 && initialRect.height > 0) camera.aspect = initialRect.width / initialRect.height
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = SRGBColorSpace
  const disposeEnvironment = lightModel(scene, renderer)
  host.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = true
  const reset = () => {
    placeModelCamera(camera, bounds, radius)
    controls.target.copy(center)
    controls.update()
  }
  document.getElementById('reset')!.addEventListener('click', reset)
  reset()
  const resize = () => {
    const { width, height } = host.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    camera.aspect = width / height
    placeModelCamera(camera, bounds, radius)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  const mixer = loaded.animations.length ? new AnimationMixer(loaded.object) : null
  for (const clip of loaded.animations) mixer?.clipAction(clip).play()
  let previous = performance.now()
  let frame = 0
  const draw = (now: number) => {
    mixer?.update(Math.min((now - previous) / 1000, 0.1))
    previous = now
    controls.update()
    updateModelCameraClipPlanes(camera, bounds, radius)
    renderer.render(scene, camera)
    frame = requestAnimationFrame(draw)
  }
  frame = requestAnimationFrame(draw)
  status('')
  document.getElementById('reset')!.hidden = false
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    controls.dispose()
    mixer?.stopAllAction()
    disposeModel(loaded.object)
    disposeEnvironment()
    renderer.dispose()
  }, { once: true })
}

void main().catch((error: unknown) => {
  status(error instanceof Error ? error.message : String(error))
})
