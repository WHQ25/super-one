import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Shrink } from 'lucide-react'
import { ToolBrandIcon } from '@/components/chat/ToolIcon'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { getToolDisplay } from '@/components/chat/tool-display'
import { ActivityHeaderPrefix } from '@/components/activity/ActivityHeaderPrefix'
import { tabChipClass, TabTitle, TabActionButton } from '@/components/activity/ActivityTab'
import { Z } from '@/lib/z-layers'
import { useMcpAppLayout } from './layout-store'
import type { McpAppDesktopApi } from './desktop-executor'

export function McpAppFullscreen({ appInstanceId, server, toolName, container, api, url, onExit }: {
  appInstanceId: string; server: string; toolName: string; container: HTMLElement | undefined; api: McpAppDesktopApi; url: string; onExit(): void
}) {
  const { t } = useTranslation()
  const icon = useMcpServerIcon(server)
  const ref = useCallback((element: HTMLDivElement | null) => useMcpAppLayout.getState().surface(appInstanceId, 'fullscreen', element), [appInstanceId])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); onExit() } }
    const unsubscribe = api.onMcpAppEscape?.(event => { if (event.url === url && !document.querySelector('[role="dialog"]')) onExit() })
    window.addEventListener('keydown', escape)
    return () => { unsubscribe?.(); window.removeEventListener('keydown', escape) }
  }, [api, url, onExit])
  return createPortal(<div data-mcp-app-fullscreen={appInstanceId} className="absolute inset-0 flex flex-col overflow-hidden bg-card" style={{ zIndex: Z.HOST_MCP_APP_FULLSCREEN }}>
    <div data-mcp-app-fullscreen-header className="flex h-[34px] shrink-0 items-center p-[5px]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <ActivityHeaderPrefix maximized />
      <div className={tabChipClass(true)} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <ToolBrandIcon src={icon} alt={server} icon={getToolDisplay(toolName, {}).icon} />
        <TabTitle>{server}</TabTitle>
        <TabActionButton active onClick={onExit} title={t('mcpApp.exitFullscreen')}><Shrink className="size-3 shrink-0" /></TabActionButton>
      </div>
    </div>
    <div ref={ref} className="min-h-0 flex-1" />
  </div>, container ?? document.body)
}
