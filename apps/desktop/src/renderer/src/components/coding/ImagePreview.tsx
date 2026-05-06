import { useEffect, useRef } from 'react'
import { TransformWrapper, TransformComponent, useControls, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { usePreventFocusSteal } from '@/hooks/usePreventFocusSteal'

const PAN_STEP = 60
const ZOOM_STEP = 0.2

interface ImagePreviewProps {
  src: string
  alt: string
}

function Controls() {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  const ref = usePreventFocusSteal<HTMLDivElement>()
  return (
    <div ref={ref} className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur-sm">
      <button onClick={() => zoomOut()} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
        <ZoomOut className="size-3.5" />
      </button>
      <button onClick={() => zoomIn()} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
        <ZoomIn className="size-3.5" />
      </button>
      <div className="mx-0.5 h-3 w-px bg-border" />
      <button onClick={() => resetTransform()} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
        <RotateCcw className="size-3" />
      </button>
    </div>
  )
}

export function ImagePreview({ src, alt }: ImagePreviewProps) {
  const apiRef = useRef<ReactZoomPanPinchContentRef | null>(null)

  useEffect(() => {
    apiRef.current?.resetTransform()
  }, [src])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      const api = apiRef.current
      if (!api) return
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault()
          api.zoomIn(ZOOM_STEP)
          break
        case '-':
        case '_':
          e.preventDefault()
          api.zoomOut(ZOOM_STEP)
          break
        case '0':
          e.preventDefault()
          api.resetTransform()
          break
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          const { positionX, positionY, scale } = api.instance.transformState
          const dx = e.key === 'ArrowLeft' ? PAN_STEP : e.key === 'ArrowRight' ? -PAN_STEP : 0
          const dy = e.key === 'ArrowUp' ? PAN_STEP : e.key === 'ArrowDown' ? -PAN_STEP : 0
          api.setTransform(positionX + dx, positionY + dy, scale)
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative h-full w-full">
      <TransformWrapper
        ref={apiRef}
        minScale={0.1}
        maxScale={10}
        centerOnInit
        smooth
        wheel={{ smoothStep: 0.012 }}
        pinch={{ step: 10 }}
      >
        <Controls />
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => apiRef.current?.resetTransform()}
            className="max-h-full max-w-full select-none object-contain"
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
