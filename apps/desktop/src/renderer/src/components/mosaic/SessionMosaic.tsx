import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { SessionPane } from '@/components/chat/SessionPane'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import { useMosaicStore } from './mosaic-store'
import { computeCapacity, type GridTile } from './mosaic-grid'

function MosaicTile({ tile, focused }: { tile: GridTile; focused: boolean }) {
  return (
    <div
      onMouseDownCapture={() => { if (!focused) useMosaicStore.getState().setFocus(tile.id) }}
      style={{ gridRow: tile.row + 1, gridColumn: tile.col + 1 }}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card',
        focused ? 'border-primary ring-2 ring-primary/35' : 'border-border/50',
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5">
        <SessionTitleAnimated sessionId={tile.sessionId} fallback="Session" className="min-w-0 flex-1 text-xs text-muted-foreground" />
        <IconButton
          size="xs"
          variant="nested"
          tooltip="Close"
          onClick={(e) => { e.stopPropagation(); useMosaicStore.getState().removeTile(tile.id) }}
        >
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <SessionPane scope={{ projectPath: tile.projectPath, sessionId: tile.sessionId }} readOnly={!focused} />
      </div>
    </div>
  )
}

export function SessionMosaic() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { tiles, focusedTileId } = useMosaicStore(useShallow((s) => ({ tiles: s.tiles, focusedTileId: s.focusedTileId })))

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let prevW = 0
    let prevLeft = 0
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const { width, height } = rect
      const { cols, rows } = computeCapacity(width, height)
      // Top is anchored by the titlebar, so vertical shrink is always from the
      // bottom. Horizontal shrink is from the right (window narrowing) unless the
      // left edge moved inward (sidebar widening), which peels from the left.
      const hEdge = width < prevW && rect.left > prevLeft + 0.5 ? 'left' : 'right'
      prevW = width
      prevLeft = rect.left
      useMosaicStore.getState().applyCapacity(cols, rows, hEdge, 'bottom')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const usedCols = Math.max(1, ...tiles.map((t) => t.col + 1))
  const usedRows = Math.max(1, ...tiles.map((t) => t.row + 1))

  return (
    <div
      ref={containerRef}
      className="grid min-h-0 min-w-0 flex-1 gap-[5px] overflow-hidden p-[5px]"
      style={{
        gridTemplateColumns: `repeat(${usedCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${usedRows}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((tile) => (
        <MosaicTile key={tile.id} tile={tile} focused={tile.id === focusedTileId} />
      ))}
    </div>
  )
}
