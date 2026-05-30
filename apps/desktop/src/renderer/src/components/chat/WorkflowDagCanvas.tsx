import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { WorkflowDag } from './WorkflowDag'
import { layoutDag, DAG_NODE_SIZE, type Dag, type DagNode, type DagNodeStats } from './workflow-dag'

const ZOOM_MIN = 0.3
const ZOOM_MAX = 3
const FIT_PADDING = 48
const PAN_MARGIN = 300
const MINIMAP = { width: 168, height: 120 }
const DRAG_THRESHOLD = 4
const CARD_W = 380

interface Point { x: number; y: number }
interface Size { width: number; height: number }

interface WorkflowDagCanvasProps {
  dag: Dag
  selectedNodeId?: string
  onSelectNode?: (node: DagNode) => void
  stats?: Map<string, DagNodeStats>
  onContainerWidth?: (width: number) => void
  overlayHeader?: ReactNode
  overlayContent?: ReactNode
  onCloseOverlay?: () => void
}

export function WorkflowDagCanvas({
  dag,
  selectedNodeId,
  onSelectNode,
  stats,
  onContainerWidth,
  overlayHeader,
  overlayContent,
  onCloseOverlay,
}: WorkflowDagCanvasProps) {
  const layout = useMemo(() => layoutDag(dag), [dag])
  const content: Size = { width: layout.width, height: layout.height }

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isKeyPanning, setIsKeyPanning] = useState(false)
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const baseScaleRef = useRef(1)
  const dragStart = useRef<Point>({ x: 0, y: 0 })
  const draggedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevSelectedRef = useRef(selectedNodeId)

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (prevSelectedRef.current && !selectedNodeId) containerRef.current?.focus()
    prevSelectedRef.current = selectedNodeId
  }, [selectedNodeId])

  const effectiveScale = baseScaleRef.current * zoom
  const tx = content.width > 0 ? (containerSize.width - content.width * effectiveScale) / 2 + pan.x : 0
  const ty = content.height > 0 ? (containerSize.height - content.height * effectiveScale) / 2 + pan.y : 0

  const constrainPan = useCallback((next: Point): Point => {
    if (!content.width || !containerSize.width) return next
    const s = baseScaleRef.current * zoom
    const maxX = Math.max(0, (content.width * s - containerSize.width) / 2 + PAN_MARGIN)
    const maxY = Math.max(0, (content.height * s - containerSize.height) / 2 + PAN_MARGIN)
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) }
  }, [content.width, content.height, containerSize, zoom])

  const handlePan = useCallback((dx: number, dy: number) => {
    setPan((prev) => constrainPan({ x: prev.x + dx, y: prev.y + dy }))
  }, [constrainPan])

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, ZOOM_MAX)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, ZOOM_MIN)), [])
  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      setContainerSize({ width: cw, height: ch })
      onContainerWidth?.(cw)
      if (content.width > 0 && content.height > 0) {
        const fit = Math.min((cw - FIT_PADDING) / content.width, (ch - FIT_PADDING) / content.height)
        baseScaleRef.current = Math.min(1, Math.max(0.2, fit))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [content.width, content.height, onContainerWidth])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)))
    } else {
      e.preventDefault()
      setPan((prev) => constrainPan({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
    }
  }, [constrainPan])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const pressed = new Map<string, number>()
    let rafId: number | null = null
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let isHolding = false
    const HOLD = 200
    const cw = containerSize.width || 800
    const ch = containerSize.height || 600
    const SPEED_X = cw * 0.012
    const SPEED_Y = ch * 0.012
    const STEP_X = cw * 0.12
    const STEP_Y = ch * 0.12

    const delta = (): [number, number] => {
      let dx = 0, dy = 0
      if (pressed.has('ArrowUp')) dy += SPEED_Y
      if (pressed.has('ArrowDown')) dy -= SPEED_Y
      if (pressed.has('ArrowLeft')) dx += SPEED_X
      if (pressed.has('ArrowRight')) dx -= SPEED_X
      return [dx, dy]
    }
    const animate = () => {
      if (pressed.size === 0) { rafId = null; return }
      const [dx, dy] = delta()
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
        if (e.key === '+' || e.key === '=') zoomIn()
        else if (e.key === '-' || e.key === '_') zoomOut()
        else resetView()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        if (e.repeat || pressed.has(e.key)) return
        pressed.set(e.key, Date.now())
        if (isHolding) return
        if (holdTimer === null) holdTimer = setTimeout(() => { holdTimer = null; if (pressed.size > 0) startHold() }, HOLD)
        return
      }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn() }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut() }
      else if (e.key === '0') { e.preventDefault(); resetView() }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      const t = pressed.get(e.key)
      if (t === undefined) return
      pressed.delete(e.key)
      if (!isHolding && Date.now() - t < HOLD) {
        if (e.key === 'ArrowUp') handlePan(0, STEP_Y)
        else if (e.key === 'ArrowDown') handlePan(0, -STEP_Y)
        else if (e.key === 'ArrowLeft') handlePan(STEP_X, 0)
        else if (e.key === 'ArrowRight') handlePan(-STEP_X, 0)
      }
      if (pressed.size === 0) {
        if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null }
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        isHolding = false
        setIsKeyPanning(false)
      }
    }
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('keyup', onKeyUp)
      if (holdTimer !== null) clearTimeout(holdTimer)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [containerSize, handlePan, zoomIn, zoomOut, resetView])

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    draggedRef.current = false
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const next = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    if (Math.abs(next.x - pan.x) > DRAG_THRESHOLD || Math.abs(next.y - pan.y) > DRAG_THRESHOLD) draggedRef.current = true
    setPan(constrainPan(next))
  }
  const onMouseUp = () => setIsDragging(false)

  const handleSelect = useCallback((node: DagNode) => {
    if (draggedRef.current) return
    onSelectNode?.(node)
  }, [onSelectNode])

  const selectedPos = selectedNodeId ? layout.pos.get(selectedNodeId) : undefined
  const card = selectedPos && overlayContent
    ? cardPlacement(selectedPos, tx, ty, effectiveScale, containerSize)
    : null

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/10">
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1 text-[10px] text-muted-foreground/70">
        <span className="tabular-nums">{Math.round(effectiveScale * 100)}%</span>
        <span>·</span>
        <Kbd variant="square">+</Kbd><Kbd variant="square">-</Kbd> zoom
        <span>·</span>
        <Kbd>↑↓←→</Kbd> move
        <span>·</span>
        <Kbd variant="square">0</Kbd> reset
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        className="relative h-full w-full select-none overflow-hidden outline-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div
          className={isDragging || isKeyPanning ? '' : 'transition-transform duration-150 ease-out'}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: content.width,
            height: content.height,
            transformOrigin: '0 0',
            transform: `translate(${tx}px, ${ty}px) scale(${effectiveScale})`,
          }}
        >
          <WorkflowDag dag={dag} bare selectedNodeId={selectedNodeId} stats={stats} onSelect={handleSelect} />
        </div>
      </div>

      {content.width > 0 && (
        <Minimap dag={dag} content={content} containerSize={containerSize} effectiveScale={effectiveScale} pan={pan} onNavigate={(p) => setPan(constrainPan(p))} />
      )}

      {card && (
        <div
          className="absolute z-30 flex max-h-[70%] flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
          style={{ left: card.left, top: card.top, width: CARD_W }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">{overlayHeader}</div>
            <button
              type="button"
              onClick={onCloseOverlay}
              className="inline-flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{overlayContent}</div>
        </div>
      )}
    </div>
  )
}

function cardPlacement(
  pos: { x: number; y: number },
  tx: number,
  ty: number,
  scale: number,
  container: Size,
): { left: number; top: number } {
  const nodeLeft = tx + pos.x * scale
  const nodeTop = ty + pos.y * scale
  const nodeRight = nodeLeft + DAG_NODE_SIZE.w * scale
  const gap = 12
  let left = nodeRight + gap
  if (left + CARD_W > container.width - 8) left = nodeLeft - gap - CARD_W
  left = Math.max(8, Math.min(left, container.width - CARD_W - 8))
  const top = Math.max(8, Math.min(nodeTop, container.height - 120))
  return { left, top }
}

interface MinimapProps {
  dag: Dag
  content: Size
  containerSize: Size
  effectiveScale: number
  pan: Point
  onNavigate: (pan: Point) => void
}

function Minimap({ dag, content, containerSize, effectiveScale, pan, onNavigate }: MinimapProps) {
  const ref = useRef<HTMLDivElement>(null)
  const mmScale = Math.min(MINIMAP.width / content.width, MINIMAP.height / content.height) * 0.88
  const scaledW = content.width * mmScale
  const scaledH = content.height * mmScale

  const vpW = Math.min((containerSize.width / effectiveScale) * mmScale, MINIMAP.width)
  const vpH = Math.min((containerSize.height / effectiveScale) * mmScale, MINIMAP.height)
  const cx = MINIMAP.width / 2
  const cy = MINIMAP.height / 2
  const vpX = Math.max(0, Math.min(MINIMAP.width - vpW, cx - (pan.x / effectiveScale) * mmScale - vpW / 2))
  const vpY = Math.max(0, Math.min(MINIMAP.height - vpH, cy - (pan.y / effectiveScale) * mmScale - vpH / 2))

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const offX = e.clientX - rect.left - cx
    const offY = e.clientY - rect.top - cy
    onNavigate({ x: -(offX / mmScale) * effectiveScale, y: -(offY / mmScale) * effectiveScale })
  }

  return (
    <div
      ref={ref}
      onClick={onClick}
      className="absolute bottom-3 left-3 z-20 cursor-pointer overflow-hidden rounded border border-border/60 bg-background/80 shadow-md backdrop-blur-sm"
      style={{ width: MINIMAP.width, height: MINIMAP.height }}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="opacity-60 [&_svg]:!h-full [&_svg]:!w-full [&_svg]:!max-w-none"
          style={{ width: scaledW, height: scaledH }}
        >
          <WorkflowDag dag={dag} bare />
        </div>
      </div>
      <div
        className="pointer-events-none absolute border-2 border-primary/70 bg-primary/10"
        style={{ left: vpX, top: vpY, width: vpW, height: vpH }}
      />
    </div>
  )
}
