import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RotateCcw } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { DeviceFrameProjector } from './device-input'
import type { DeviceModelSource, MountedDeviceModel } from './device-model-renderer'

export type { DeviceModelSource }

// three.js and the model loaders stay out of the startup chunk: the panel that
// hosts this view is mounted from App, and most sessions never turn the 3D view on.
const loadRenderer = () => import('./device-model-renderer')
const loadDesktopDeviceModel = (model: string) => loadRenderer().then((renderer) => renderer.loadDesktopDeviceModel(model))

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
  const sceneRef = useRef<MountedDeviceModel | null>(null)
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
      const [{ mountDeviceModel }, source] = await Promise.all([loadRenderer(), loadModel(model)])
      if (!source) throw new Error(`No 3D model for ${model}`)
      const mounted = await mountDeviceModel(host, source, latest, () => cancelled)
      if (!mounted) return
      sceneRef.current = mounted
      teardown = () => {
        mounted.teardown()
        sceneRef.current = null
        latest.current.onProjector(null)
      }
      latest.current.onProjector(mounted.projector)
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
