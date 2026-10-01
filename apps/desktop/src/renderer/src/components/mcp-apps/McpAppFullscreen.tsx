import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Puzzle, X } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { Z } from '@/lib/z-layers'
import { useMcpAppLayout } from './layout-store'
import type { McpAppDesktopApi } from './desktop-executor'

export function McpAppFullscreen({ appInstanceId, server, container, api, url, onExit }: {
  appInstanceId: string; server: string; container: HTMLElement | undefined; api: McpAppDesktopApi; url: string; onExit(): void
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
  return createPortal(<div data-mcp-app-fullscreen={appInstanceId} className="absolute inset-0 flex flex-col overflow-hidden bg-background" style={{ zIndex: Z.HOST_MCP_APP_FULLSCREEN }}>
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2 text-xs">
      {icon ? <img src={icon} alt="" className="size-3.5 shrink-0" /> : <Puzzle className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate font-medium">{server}</span>
      <IconButton size="sm" variant="ghost" tooltip={t('mcpApp.exitFullscreen')} aria-label={t('mcpApp.exitFullscreen')} onClick={onExit}><X className="size-3.5" /></IconButton>
    </div>
    <div ref={ref} className="min-h-0 flex-1" />
  </div>, container ?? document.body)
}
