import { useEffect, useRef } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

interface ImagePreviewProps {
  src: string
  alt: string
}

function Controls() {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur-sm">
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
  const resetRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    resetRef.current?.()
  }, [src])

  return (
    <div className="relative h-full">
      <TransformWrapper
        minScale={0.1}
        maxScale={10}
        centerOnInit
        smooth
        wheel={{ smoothStep: 0.012 }}
        pinch={{ step: 10 }}
        onInit={(ref) => { resetRef.current = () => ref.resetTransform() }}
      >
        <Controls />
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full select-none object-contain" />
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
