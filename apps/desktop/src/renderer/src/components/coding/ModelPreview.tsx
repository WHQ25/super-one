import { useEffect, useRef, useState } from 'react'
import { Box3, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, AnimationMixer, type Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { MODEL_PREVIEW_MAX_BYTES } from '@superone/shared/file-preview'
import { disposeModel, parseModel, placeModelCamera, updateModelCameraClipPlanes } from './model-loader'
import { addModelFillLights, lightModel } from './model-environment'

interface ModelPreviewProps {
  src: string
  name: string
  interactive?: boolean
  onError?: () => void
  /** Injectable for local USDZ stories; the desktop uses the native composer. */
  composeUsdz?: (bytes: Uint8Array, selections: Record<string, string>) => Promise<{
    archive: Uint8Array
    variants: Array<{ name: string; options: string[]; selected: string }>
  }>
}

function baseOf(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) return ''
  return src.slice(0, src.lastIndexOf('/') + 1)
}

/** Orbit to rotate, wheel to zoom, right drag to pan. The parent owns the file URL. */
export function ModelPreview({ src, name, interactive = true, onError, composeUsdz }: ModelPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const resetRef = useRef<(() => void) | null>(null)
  const sourceRef = useRef<{ src: string; bytes: ArrayBuffer } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [variantSets, setVariantSets] = useState<Array<{ name: string; options: string[]; selected: string }>>([])
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({})

  useEffect(() => {
    sourceRef.current = null
    setVariantSets([])
    setSelectedVariants({})
  }, [src])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !src) return
    let cancelled = false
    const abort = new AbortController()
    let cleanupScene: (() => void) | undefined
    let stagedModel: Object3D | null = null
    let provisionalRenderer: WebGLRenderer | null = null
    let provisionalEnvironment: (() => void) | null = null
    setStatus('loading')
    setMessage('')

    void (async () => {
      let bytes = sourceRef.current?.src === src ? sourceRef.current.bytes : undefined
      if (!bytes) {
        const response = await fetch(src, { signal: abort.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const announced = Number(response.headers.get('content-length'))
        if (announced > MODEL_PREVIEW_MAX_BYTES) throw new Error('Model exceeds 100 MB preview limit')
        bytes = await response.arrayBuffer()
        if (bytes.byteLength > MODEL_PREVIEW_MAX_BYTES) throw new Error('Model exceeds 100 MB preview limit')
        sourceRef.current = { src, bytes }
      }
      if (cancelled) return

      const appleUsd = name.toLowerCase().endsWith('.usdz')
      let previewBytes = bytes
      let composeError: unknown
      const compose = composeUsdz ?? window.app?.composeUsdzPreview
      if (appleUsd && compose) {
        try {
          const composed = await compose(new Uint8Array(bytes), selectedVariants)
          previewBytes = composed.archive.buffer.slice(composed.archive.byteOffset, composed.archive.byteOffset + composed.archive.byteLength) as ArrayBuffer
          if (!cancelled) setVariantSets(composed.variants)
        } catch (error) {
          composeError = error
        }
      }
      if (cancelled) return
      let loaded: Awaited<ReturnType<typeof parseModel>>
      try {
        loaded = await parseModel(name, previewBytes, baseOf(src))
      } catch (error) {
        throw composeError ?? error
      }
      stagedModel = loaded.object
      if (cancelled) { disposeModel(loaded.object); stagedModel = null; return }
      const bounds = new Box3().setFromObject(loaded.object)
      if (bounds.isEmpty()) throw new Error('No visible geometry in model')
      const size = bounds.getSize(new Vector3())
      const center = bounds.getCenter(new Vector3())
      const radius = Math.max(size.length() / 2, 0.01)
      const initialDirection = appleUsd ? new Vector3(0, 0, 1) : undefined

      const scene = new Scene()
      if (!appleUsd) addModelFillLights(scene)
      scene.add(loaded.object)

      const camera = new PerspectiveCamera(45, 1, 0.001, Math.max(1000, radius * 100))
      const initialRect = host.getBoundingClientRect()
      if (initialRect.width > 0 && initialRect.height > 0) camera.aspect = initialRect.width / initialRect.height
      const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      provisionalRenderer = renderer
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.outputColorSpace = SRGBColorSpace
      const disposeEnvironment = appleUsd
        ? await import('./apple-usdz-environment').then(({ lightAppleUsdModel }) => lightAppleUsdModel(scene, renderer)).catch(() => {
          addModelFillLights(scene)
          return lightModel(scene, renderer)
        })
        : lightModel(scene, renderer)
      provisionalEnvironment = disposeEnvironment
      if (cancelled) { disposeEnvironment(); renderer.dispose(); disposeModel(loaded.object); stagedModel = null; return }
      host.appendChild(renderer.domElement)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enabled = interactive
      controls.enableDamping = true
      const reset = () => {
        placeModelCamera(camera, bounds, radius, initialDirection)
        controls.target.copy(center)
        controls.update()
      }
      resetRef.current = reset
      reset()
      const resize = () => {
        const { width, height } = host.getBoundingClientRect()
        if (width <= 0 || height <= 0) return
        camera.aspect = width / height
        placeModelCamera(camera, bounds, radius, initialDirection)
        camera.updateProjectionMatrix()
        renderer.setSize(width, height)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()
      const mixer = loaded.animations.length ? new AnimationMixer(loaded.object) : null
      for (const clip of loaded.animations) mixer?.clipAction(clip).play()
      let frame = 0
      let last = performance.now()
      const draw = (now: number) => {
        const delta = Math.min((now - last) / 1000, 0.1)
        last = now
        mixer?.update(delta)
        controls.update()
        updateModelCameraClipPlanes(camera, bounds, radius)
        renderer.render(scene, camera)
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
      cleanupScene = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        mixer?.stopAllAction()
        disposeModel(loaded.object)
        disposeEnvironment()
        renderer.dispose()
        renderer.domElement.remove()
        resetRef.current = null
      }
      provisionalRenderer = null
      provisionalEnvironment = null
      stagedModel = null
      setStatus('ready')
    })().catch((error: unknown) => {
      if (stagedModel) { disposeModel(stagedModel); stagedModel = null }
      provisionalEnvironment?.()
      provisionalRenderer?.dispose()
      if (cancelled || abort.signal.aborted) return
      setMessage(error instanceof Error ? error.message : String(error))
      setStatus('error')
      onError?.()
    })

    return () => {
      cancelled = true
      abort.abort()
      cleanupScene?.()
    }
  }, [src, name, interactive, onError, composeUsdz, selectedVariants])

  return (
    <div className="relative size-full min-h-48 overflow-hidden bg-transparent" data-testid="model-preview">
      <div ref={hostRef} className="size-full" />
      {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
      {status === 'error' && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">{message}</div>}
      {status === 'ready' && interactive && (
        <Button variant="secondary" size="icon" className="absolute right-3 top-3 size-7" title="Reset view" onClick={() => resetRef.current?.()}>
          <RotateCcw className="size-3.5" />
        </Button>
      )}
      {status === 'ready' && interactive && variantSets.length > 0 && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-2 rounded-lg border border-border bg-background/90 p-2 text-xs shadow-sm backdrop-blur">
            {variantSets.map((set) => (
              <label key={set.name} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{set.name}</span>
                <select
                  aria-label={set.name}
                  className="max-w-36 rounded border border-input bg-background px-1.5 py-1 text-foreground"
                  value={selectedVariants[set.name] ?? set.selected}
                  onChange={(event) => setSelectedVariants((current) => ({ ...current, [set.name]: event.target.value }))}
                >
                  {set.options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
