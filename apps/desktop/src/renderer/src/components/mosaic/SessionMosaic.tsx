import { useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize, Moon, Sun, X } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { SessionPane } from '@/components/chat/SessionPane'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { useChatStore, extractSessionTitle } from '@/stores/chat'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import { HeaderSessionMenu } from '@/components/chat/HeaderSessionMenu'
import { useTheme } from '@/hooks/useTheme'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useAppStore } from '@/stores/app'
import { useMosaicStore } from './mosaic-store'
import { MosaicDivider } from './MosaicDivider'
import { MosaicDropZone } from './MosaicDropZone'
import { measureMin, topLeftLeafId, topRightLeafId, type MosaicLeaf, type MosaicNode, type MosaicPath } from './mosaic-tree'

const isMac = window.app.platform === 'darwin'

interface RenderCtx {
  topLeftId: string
  topRightId: string
  reserveTrafficLights: boolean
  showSidebar: boolean
  themeDark: boolean
  onToggleTheme: () => void
  containerRef: RefObject<HTMLDivElement | null>
}

function MosaicTile({ tile, ctx }: { tile: MosaicLeaf; ctx: RenderCtx }) {
  const { t } = useTranslation()
  const focused = useMosaicStore((s) => s.focusedTileId === tile.id)
  const dragging = useMosaicStore((s) => s.draggingSession)
  const titleFallback = useChatStore((s) => {
    const sess = s.projectSessions[tile.projectPath]?._sessions[tile.sessionId]
    return (sess?._title ?? (sess ? extractSessionTitle(sess.messages) : null)) ?? 'New Session'
  })
  const isTopLeft = tile.id === ctx.topLeftId
  const isTopRight = tile.id === ctx.topRightId
  return (
    <div
      data-tile-id={tile.id}
      onMouseDownCapture={() => { if (!focused) useMosaicStore.getState().setFocus(tile.id) }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex h-[34px] shrink-0 items-center pl-[18px] pr-2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        {ctx.reserveTrafficLights && isTopLeft && <div className="w-[60px] shrink-0" />}
        {isTopLeft && !ctx.showSidebar && <LayoutToggle />}
        <div className="group/htitle flex min-w-0 items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <SessionTitleAnimated sessionId={tile.sessionId} fallback={titleFallback} className="min-w-0 text-xs text-muted-foreground" />
          <HeaderSessionMenu sessionId={tile.sessionId} folderPath={tile.projectPath} />
        </div>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-0.5 pl-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <IconButton size="xs" variant="nested" tooltip={t('tooltips.maximize')} onClick={(e) => { e.stopPropagation(); const m = useMosaicStore.getState(); m.setFocus(tile.id); m.exitToSingle() }}>
            <Maximize className="size-3.5" />
          </IconButton>
          <IconButton size="xs" variant="nested" tooltip="Close" onClick={(e) => { e.stopPropagation(); useMosaicStore.getState().removeTile(tile.id) }}>
            <X className="size-3.5" />
          </IconButton>
          {isTopRight && (
            <IconButton size="xs" variant="nested" tooltip="Toggle theme" onClick={(e) => { e.stopPropagation(); ctx.onToggleTheme() }}>
              {ctx.themeDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </IconButton>
          )}
        </div>
      </div>
      <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity', !focused && 'opacity-75')}>
        <SessionPane scope={{ projectPath: tile.projectPath, sessionId: tile.sessionId }} />
      </div>
      {dragging && (
        <MosaicDropZone
          tileId={tile.id}
          containerRef={ctx.containerRef}
          onDropSession={(fp, sid, edge) => useMosaicStore.getState().addTile(fp, sid, { tileId: tile.id, edge })}
        />
      )}
    </div>
  )
}

function MosaicNodeView({ node, path, ctx }: { node: MosaicNode; path: MosaicPath; ctx: RenderCtx }) {
  if (node.type === 'leaf') return <MosaicTile tile={node} ctx={ctx} />
  const horizontal = node.direction === 'row'
  const firstMin = measureMin(node.first)
  const secondMin = measureMin(node.second)
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1', !horizontal && 'flex-col')}>
      <div className="flex" style={{ flex: node.ratio, minWidth: firstMin.w, minHeight: firstMin.h }}>
        <MosaicNodeView node={node.first} path={[...path, 'first']} ctx={ctx} />
      </div>
      <MosaicDivider
        direction={node.direction}
        path={path}
        firstMin={horizontal ? firstMin.w : firstMin.h}
        secondMin={horizontal ? secondMin.w : secondMin.h}
      />
      <div className="flex" style={{ flex: 1 - node.ratio, minWidth: secondMin.w, minHeight: secondMin.h }}>
        <MosaicNodeView node={node.second} path={[...path, 'second']} ctx={ctx} />
      </div>
    </div>
  )
}

export function SessionMosaic() {
  const containerRef = useRef<HTMLDivElement>(null)
  const root = useMosaicStore((s) => s.root)
  const theme = useTheme()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const isFullscreen = useFullscreen()
  if (!root) return null
  const ctx: RenderCtx = {
    topLeftId: topLeftLeafId(root),
    topRightId: topRightLeafId(root),
    reserveTrafficLights: isMac && !showSidebar && !isFullscreen,
    showSidebar,
    themeDark: theme.dark,
    onToggleTheme: theme.toggle,
    containerRef,
  }
  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <MosaicNodeView node={root} path={[]} ctx={ctx} />
    </div>
  )
}
