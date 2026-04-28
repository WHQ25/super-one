import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'

const MINIMAP_SIZE = { width: 180, height: 135 }
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const FIT_PADDING = 60
const PAN_MARGIN = 350

export interface Size { width: number; height: number }
interface Point { x: number; y: number }

export function parseSvgSize(raw: string): Size {
  const m = raw.match(/viewBox="([^"]+)"/)
  if (m) {
    const parts = m[1].split(/[\s,]+/).map(Number)
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }
  const wm = raw.match(/\bwidth="([\d.]+)"/)
  const hm = raw.match(/\bheight="([\d.]+)"/)
  return {
    width: wm ? parseFloat(wm[1]) : 800,
    height: hm ? parseFloat(hm[1]) : 600,
  }
}

// --- Minimap ---

interface MinimapProps {
  svg: string
  svgSize: Size
  containerSize: Size
  effectiveScale: number
  pan: Point
  onNavigate: (newPan: Point) => void
}

function Minimap({ svg, svgSize, containerSize, effectiveScale, pan, onNavigate }: MinimapProps) {
  const minimapRef = useRef<HTMLDivElement>(null)

  const mmScale = Math.min(
    MINIMAP_SIZE.width / svgSize.width,
    MINIMAP_SIZE.height / svgSize.height,
  ) * 0.85

  const scaledW = svgSize.width * mmScale
  const scaledH = svgSize.height * mmScale

  const vpW = Math.min((containerSize.width / effectiveScale) * mmScale, MINIMAP_SIZE.width)
  const vpH = Math.min((containerSize.height / effectiveScale) * mmScale, MINIMAP_SIZE.height)

  const mmCx = MINIMAP_SIZE.width / 2
  const mmCy = MINIMAP_SIZE.height / 2
  const panOffX = -(pan.x / effectiveScale) * mmScale
  const panOffY = -(pan.y / effectiveScale) * mmScale
  const vpX = Math.max(0, Math.min(MINIMAP_SIZE.width - vpW, mmCx + panOffX - vpW / 2))
  const vpY = Math.max(0, Math.min(MINIMAP_SIZE.height - vpH, mmCy + panOffY - vpH / 2))

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!minimapRef.current) return
    const rect = minimapRef.current.getBoundingClientRect()
    const offX = e.clientX - rect.left - mmCx
    const offY = e.clientY - rect.top - mmCy
    onNavigate({
      x: -(offX / mmScale) * effectiveScale,
      y: -(offY / mmScale) * effectiveScale,
    })
  }

  return (
    <div
      ref={minimapRef}
      className="absolute bottom-4 left-4 z-20 cursor-pointer overflow-hidden rounded border border-white/20 bg-black/70 shadow-md backdrop-blur-sm"
      style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }}
      onClick={handleClick}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="opacity-50 [&_svg]:block [&_svg]:w-full [&_svg]:h-full [&_svg]:!max-w-none"
          style={{ width: scaledW, height: scaledH }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div
        className="pointer-events-none absolute border-2 border-blue-600/60 dark:border-blue-400/60 bg-blue-600/15 dark:bg-blue-400/15 transition-all duration-75"
        style={{ left: vpX, top: vpY, width: vpW, height: vpH }}
      />
    </div>
  )
}

// --- Fullscreen viewer ---

interface MermaidFullscreenProps {
  svg: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MermaidFullscreen({ svg, open, onOpenChange }: MermaidFullscreenProps) {
  const svgSize = useMemo(() => parseSvgSize(svg), [svg])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isKeyPanning, setIsKeyPanning] = useState(false)
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 })
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const baseScaleRef = useRef(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<HTMLDivElement>(null)

  const effectiveScale = baseScaleRef.current * zoom

  const tx = svgSize.width > 0
    ? (containerSize.width - svgSize.width * effectiveScale) / 2 + pan.x
    : 0
  const ty = svgSize.height > 0
    ? (containerSize.height - svgSize.height * effectiveScale) / 2 + pan.y
    : 0

  useEffect(() => {
    if (!open) return
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [open])

  const constrainPan = useCallback((newPan: Point) => {
    if (!svgSize.width || !containerSize.width) return newPan
    const s = baseScaleRef.current * zoom
    const scaledW = svgSize.width * s
    const scaledH = svgSize.height * s
    const maxPanX = Math.max(0, (scaledW - containerSize.width) / 2 + PAN_MARGIN)
    const maxPanY = Math.max(0, (scaledH - containerSize.height) / 2 + PAN_MARGIN)
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, newPan.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newPan.y)),
    }
  }, [svgSize, containerSize, zoom])

  const handlePan = useCallback((dx: number, dy: number) => {
    setPan((prev) => constrainPan({ x: prev.x + dx, y: prev.y + dy }))
  }, [constrainPan])

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, ZOOM_MAX)), [])
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, ZOOM_MIN)), [])
  const handleResetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)))
    } else {
      setPan((prev) => constrainPan({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
    }
  }, [constrainPan])

  useEffect(() => {
    if (!open || !containerRef.current) return
    const el = containerRef.current
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [open, handleWheel])

  useEffect(() => {
    if (!open || !svg) return
    const timer = setTimeout(() => {
      if (!containerRef.current) return
      const cw = containerRef.current.clientWidth
      const ch = containerRef.current.clientHeight
      setContainerSize({ width: cw, height: ch })
      const fitScale = Math.min(
        (cw - FIT_PADDING) / svgSize.width,
        (ch - FIT_PADDING) / svgSize.height,
      )
      const minDimScale = Math.max(
        (cw * 0.5) / svgSize.width,
        (ch * 0.5) / svgSize.height,
      )
      baseScaleRef.current = Math.max(fitScale, minDimScale)
      setZoom(1)
    }, 50)
    const handleResize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => { clearTimeout(timer); window.removeEventListener('resize', handleResize) }
  }, [open, svg])

  useEffect(() => {
    if (!open) return
    const pressedKeys = new Map<string, number>()
    let rafId: number | null = null
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let isHolding = false
    const HOLD_THRESHOLD = 200
    const cw = containerSize.width || 800
    const ch = containerSize.height || 600
    const SPEED_X = cw * 0.012
    const SPEED_Y = ch * 0.012
    const STEP_X = cw * 0.12
    const STEP_Y = ch * 0.12

    const getDelta = (): [number, number] => {
      let dx = 0, dy = 0
      if (pressedKeys.has('ArrowUp')) dy += SPEED_Y
      if (pressedKeys.has('ArrowDown')) dy -= SPEED_Y
      if (pressedKeys.has('ArrowLeft')) dx += SPEED_X
      if (pressedKeys.has('ArrowRight')) dx -= SPEED_X
      return [dx, dy]
    }

    const animate = () => {
      if (pressedKeys.size === 0) { rafId = null; return }
      const [dx, dy] = getDelta()
      if (dx !== 0 || dy !== 0) handlePan(dx, dy)
      rafId = requestAnimationFrame(animate)
    }

    const startHold = () => {
      if (isHolding) return
      isHolding = true
      setIsKeyPanning(true)
      if (rafId === null) rafId = requestAnimationFrame(animate)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) {
        e.preventDefault()
        if (e.key === '+' || e.key === '=') handleZoomIn()
        else if (e.key === '-' || e.key === '_') handleZoomOut()
        else if (e.key === '0') handleResetZoom()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        if (e.repeat || pressedKeys.has(e.key)) return
        pressedKeys.set(e.key, Date.now())
        if (isHolding) return
        if (holdTimer === null) {
          holdTimer = setTimeout(() => {
            holdTimer = null
            if (pressedKeys.size > 0) startHold()
          }, HOLD_THRESHOLD)
        }
        return
      }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); handleZoomIn() }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); handleZoomOut() }
      else if (e.key === '0') { e.preventDefault(); handleResetZoom() }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      const pressTime = pressedKeys.get(e.key)
      if (pressTime === undefined) return
      pressedKeys.delete(e.key)
      if (!isHolding && Date.now() - pressTime < HOLD_THRESHOLD) {
        if (e.key === 'ArrowUp') handlePan(0, STEP_Y)
        else if (e.key === 'ArrowDown') handlePan(0, -STEP_Y)
        else if (e.key === 'ArrowLeft') handlePan(STEP_X, 0)
        else if (e.key === 'ArrowRight') handlePan(-STEP_X, 0)
      }
      if (pressedKeys.size === 0) {
        if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null }
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        isHolding = false
        setIsKeyPanning(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (holdTimer !== null) clearTimeout(holdTimer)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [open, containerSize, handlePan, handleZoomIn, handleZoomOut, handleResetZoom])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan(constrainPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }))
  }
  const handleMouseUp = () => setIsDragging(false)

  const showMinimap = svgSize.width > 0 && svgSize.height > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[90vw] !max-h-[90vh] !w-[90vw] !h-[90vh] !p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <span className="sr-only"><DialogTitle>Mermaid Fullscreen</DialogTitle></span>
        <span className="sr-only"><DialogDescription>Fullscreen mermaid diagram viewer</DialogDescription></span>
        <div className="relative h-full w-full bg-muted">
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            <span className="mx-0.1">·</span>
            <Kbd variant="square">+</Kbd><Kbd variant="square">-</Kbd> zoom
            <span className="mx-0.1">·</span>
            <Kbd>↑↓←→</Kbd> move
            <span className="mx-0.1">·</span>
            <Kbd variant="square">0</Kbd> reset
            <span className="mx-0.1">·</span>
            <Kbd>esc</Kbd> exit
          </div>

          {svg && (
            <>
              <div
                ref={containerRef}
                className="relative h-full w-full select-none overflow-hidden"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              >
                <div
                  ref={svgRef}
                  className={`${isDragging || isKeyPanning ? '' : 'transition-transform duration-150 ease-out'} [&_svg]:block [&_svg]:w-full [&_svg]:h-full [&_svg]:!max-w-none`}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: svgSize.width,
                    height: svgSize.height,
                    transformOrigin: '0 0',
                    transform: `translate(${tx}px, ${ty}px) scale(${effectiveScale})`,
                  }}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
              {showMinimap && (
                <Minimap
                  svg={svg}
                  svgSize={svgSize}
                  containerSize={containerSize}
                  effectiveScale={effectiveScale}
                  pan={pan}
                  onNavigate={(newPan) => setPan(constrainPan(newPan))}
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
