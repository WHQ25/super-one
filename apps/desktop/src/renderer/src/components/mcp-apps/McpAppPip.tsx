import { useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Undo2 } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ToolBrandIcon } from '@/components/chat/ToolIcon'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { getToolDisplay } from '@/components/chat/tool-display'
import { usePipPlacement } from '@/hooks/use-pip-placement'
import { PIP_RESIZE_CORNERS, usePipInteraction } from '@/hooks/use-pip-interaction'
import { MINIAPP_PIP_DIMENSIONS } from '@/components/miniapp/miniapp-pip-layout'
import { Z } from '@/lib/z-layers'
import type { McpAppDisplayMode } from './use-display-mode'
import { useMcpAppLayout } from './layout-store'
const PIP_DIMS = { ...MINIAPP_PIP_DIMENSIONS, margin: 42 }
export function McpAppPip({ appInstanceId, title, toolName, viewport, onMode }: {
  appInstanceId: string; title: string; toolName: string; viewport: { width: number; height: number }
  onMode(mode: McpAppDisplayMode): void
}) {
  const icon = useMcpServerIcon(title)
  const { t } = useTranslation()
  const aspect = viewport.width / viewport.height
  const { bounds, layout, setLayout } = usePipPlacement({ key: appInstanceId, active: true, aspect, dims: PIP_DIMS })
  const { onPointerDown, startResize } = usePipInteraction({ bounds, layout, setLayout, aspect, dims: PIP_DIMS, active: true, onClick: () => {} })
  const surface = useCallback((element: HTMLDivElement | null) => useMcpAppLayout.getState().surface(appInstanceId, 'pip', element), [appInstanceId])
  return layout && createPortal(<div data-mcp-app-pip={appInstanceId} className="pointer-events-none fixed rounded-lg border border-border shadow-2xl" style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height + 30, zIndex: Z.HOST_MINIAPP }}>
    <div onPointerDown={onPointerDown} className="pointer-events-auto flex h-[30px] cursor-grab items-center gap-1 rounded-t-lg bg-background px-2 text-xs">
      <ToolBrandIcon src={icon} alt={title} icon={getToolDisplay(toolName, {}).icon} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <IconButton size="sm" variant="ghost" tooltip={t('mcpApp.inline')} className="shrink-0" onPointerDown={event => event.stopPropagation()} onClick={() => onMode('inline')}><Undo2 className="size-3.5" /></IconButton>
    </div>
    <div className="pointer-events-auto relative overflow-hidden" style={{ height: layout.height }}>
      <div ref={surface} style={{ width: viewport.width, height: viewport.height, transform: `scale(${layout.width / viewport.width})`, transformOrigin: 'top left' }} />
    </div>
    {PIP_RESIZE_CORNERS.map(({ corner, className }) => <div key={corner} className={`pointer-events-auto absolute size-4 ${className}`} onPointerDown={event => startResize(corner, event)} />)}
  </div>, document.body)
}
