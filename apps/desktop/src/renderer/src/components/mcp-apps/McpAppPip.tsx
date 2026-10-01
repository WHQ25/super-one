import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { usePipPlacement } from '@/hooks/use-pip-placement'
import { PIP_RESIZE_CORNERS, usePipInteraction } from '@/hooks/use-pip-interaction'
import { MINIAPP_PIP_DIMENSIONS } from '@/components/miniapp/miniapp-pip-layout'
import { Z } from '@/lib/z-layers'
import type { McpAppDisplayMode } from './use-display-mode'
const PIP_DIMS = { ...MINIAPP_PIP_DIMENSIONS, margin: 42 }
export interface McpAppPipSurface { left: number; top: number; width: number; height: number; scale: number }
export function McpAppPip({ appInstanceId, title, viewport, modes, onMode, onSurface }: {
  appInstanceId: string; title: string; viewport: { width: number; height: number }; modes: McpAppDisplayMode[]
  onMode(mode: McpAppDisplayMode): void; onSurface(surface: McpAppPipSurface | null): void
}) {
  const { t } = useTranslation()
  const aspect = viewport.width / viewport.height
  const { bounds, layout, setLayout } = usePipPlacement({ key: appInstanceId, active: true, aspect, dims: PIP_DIMS })
  const { onPointerDown, startResize } = usePipInteraction({ bounds, layout, setLayout, aspect, dims: PIP_DIMS, active: true, onClick: () => {} })
  useEffect(() => {
    onSurface(layout ? { left: layout.left, top: layout.top + 30, width: viewport.width, height: viewport.height, scale: layout.width / viewport.width } : null)
    return () => onSurface(null)
  }, [layout?.left, layout?.top, layout?.width, viewport.width, viewport.height, onSurface])
  return layout && createPortal(<div data-mcp-app-pip={appInstanceId} className="pointer-events-none fixed rounded-lg border border-border shadow-2xl" style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height + 30, zIndex: Z.HOST_MINIAPP }}>
    <div onPointerDown={onPointerDown} className="pointer-events-auto flex h-[30px] cursor-grab items-center gap-1 rounded-t-lg bg-background px-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {modes.includes('fullscreen') && <Button size="sm" variant="ghost" onPointerDown={event => event.stopPropagation()} onClick={() => onMode('fullscreen')}>{t('mcpApp.fullscreen')}</Button>}
      <Button size="sm" variant="ghost" onPointerDown={event => event.stopPropagation()} onClick={() => onMode('inline')}>{t('mcpApp.inline')}</Button>
    </div>
    {PIP_RESIZE_CORNERS.map(({ corner, className }) => <div key={corner} className={`pointer-events-auto absolute size-4 ${className}`} onPointerDown={event => startResize(corner, event)} />)}
  </div>, document.body)
}
