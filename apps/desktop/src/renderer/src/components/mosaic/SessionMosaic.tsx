import { useEffect, useRef } from 'react'
import { Moon, Sun, SquareTerminal, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { SessionPane } from '@/components/chat/SessionPane'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { useChatStore, extractSessionTitle } from '@/stores/chat'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import { useTheme } from '@/hooks/useTheme'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useAppStore } from '@/stores/app'
import { useTerminalStore } from '@/stores/terminal'
import { useMosaicStore } from './mosaic-store'
import { computeCapacity, type GridTile } from './mosaic-grid'

const isMac = window.app.platform === 'darwin'

interface MosaicTileProps {
  tile: GridTile
  focused: boolean
  isTopLeft: boolean
  isTopRight: boolean
  reserveTrafficLights: boolean
  showSidebar: boolean
  themeDark: boolean
  onToggleTheme: () => void
}

function openTileTerminal(tile: GridTile) {
  const m = useMosaicStore.getState()
  m.setFocus(tile.id)
  m.exitToSingle()
  useTerminalStore.getState().setOpen(tile.sessionId, true)
}

function MosaicTile({ tile, focused, isTopLeft, isTopRight, reserveTrafficLights, showSidebar, themeDark, onToggleTheme }: MosaicTileProps) {
  const titleFallback = useChatStore((s) => {
    const sess = s.projectSessions[tile.projectPath]?._sessions[tile.sessionId]
    if (!sess) return 'Session'
    return sess._title || extractSessionTitle(sess.messages) || 'Session'
  })
  return (
    <div
      onMouseDownCapture={() => { if (!focused) useMosaicStore.getState().setFocus(tile.id) }}
      style={{ gridRow: tile.row + 1, gridColumn: tile.col + 1 }}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card"
    >
      <div className="flex h-[34px] shrink-0 items-center pl-[18px] pr-2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        {reserveTrafficLights && isTopLeft && <div className="w-[60px] shrink-0" />}
        {isTopLeft && !showSidebar && <LayoutToggle />}
        <SessionTitleAnimated sessionId={tile.sessionId} fallback={titleFallback} className="min-w-0 flex-1 text-xs text-muted-foreground" />
        <div className="flex shrink-0 items-center gap-0.5 pl-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <IconButton size="xs" variant="nested" tooltip="Terminal" onClick={(e) => { e.stopPropagation(); openTileTerminal(tile) }}>
            <SquareTerminal className="size-3.5" />
          </IconButton>
          <IconButton size="xs" variant="nested" tooltip="Close" onClick={(e) => { e.stopPropagation(); useMosaicStore.getState().removeTile(tile.id) }}>
            <X className="size-3.5" />
          </IconButton>
          {isTopRight && (
            <IconButton size="xs" variant="nested" tooltip="Toggle theme" onClick={(e) => { e.stopPropagation(); onToggleTheme() }}>
              {themeDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </IconButton>
          )}
        </div>
      </div>
      <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity', !focused && 'opacity-60')}>
        <SessionPane scope={{ projectPath: tile.projectPath, sessionId: tile.sessionId }} />
      </div>
    </div>
  )
}

export function SessionMosaic() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { tiles, focusedTileId } = useMosaicStore(useShallow((s) => ({ tiles: s.tiles, focusedTileId: s.focusedTileId })))
  const theme = useTheme()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const isFullscreen = useFullscreen()
  const reserveTrafficLights = isMac && !showSidebar && !isFullscreen

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
      className="grid min-h-0 min-w-0 flex-1 gap-[5px] overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${usedCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${usedRows}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((tile) => (
        <MosaicTile
          key={tile.id}
          tile={tile}
          focused={tile.id === focusedTileId}
          isTopLeft={tile.row === 0 && tile.col === 0}
          isTopRight={tile.row === 0 && tile.col === usedCols - 1}
          reserveTrafficLights={reserveTrafficLights}
          showSidebar={showSidebar}
          themeDark={theme.dark}
          onToggleTheme={theme.toggle}
        />
      ))}
    </div>
  )
}
