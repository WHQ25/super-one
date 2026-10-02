import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, Loader2, SquareArrowOutUpRight } from 'lucide-react'
import type { McpAppFileHandler } from '@superone/shared/mcp-app-files'
import { Button } from '@superone/ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { McpAppIcon } from '@superone/ui/components/ui/mcp-app-icon'
import type { SessionScope } from '@/stores/chat-store/session-scope'
import { prefetchMcpAppFileHandlers, useMcpAppFileHandlers, useMcpAppFileRoute, type McpAppFileHandlersState } from './file-apps'
import type { McpAppRoute } from './desktop-executor'
import { useOpenFileWithMcpApp } from './open-with-menu'

interface OpenWithProps {
  absolutePath: string
  /** The pane whose session the App would belong to; `null` is the main chat. */
  scope: SessionScope | null
}

function useHandlers({ absolutePath, scope }: OpenWithProps, passive: boolean): { route: McpAppRoute | null; state: McpAppFileHandlersState | undefined } {
  const route = useMcpAppFileRoute(scope)
  useEffect(() => { prefetchMcpAppFileHandlers(route, absolutePath, { passive }) }, [route?.projectPath, route?.sessionId, absolutePath, passive])
  return { route, state: useMcpAppFileHandlers(route, absolutePath) }
}

/** Header control in an open SuperOne preview; shown only when an App can open this file. */
export function McpAppOpenWithButton(props: OpenWithProps) {
  const { t } = useTranslation()
  // Viewing a file is not a request to start the session's harness.
  const { route, state } = useHandlers(props, true)
  const open = useOpenFileWithMcpApp()
  if (state?.status !== 'ready' || !state.handlers.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" variant="ghost" tooltip={t('mcpApp.openWith')} data-mcp-app-open-with="">
          <SquareArrowOutUpRight className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('mcpApp.openWith')}</DropdownMenuLabel>
        {state.handlers.map(handler => (
          <DropdownMenuItem key={`${handler.server}:${handler.tool}`} className="text-xs" onSelect={() => open(handler, props.absolutePath, route)}>
            <HandlerIcon handler={handler} />
            {handler.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Actions under the "cannot preview" placeholder: here the user is asking to see the file, so the lookup may start the harness. */
export function McpAppOpenWithActions(props: OpenWithProps) {
  const { t } = useTranslation()
  const { route, state } = useHandlers(props, false)
  const open = useOpenFileWithMcpApp()
  if (state?.status === 'loading') return <Loader2 data-mcp-app-open-with-loading="" className="size-3.5 animate-spin opacity-60" />
  if (state?.status !== 'ready' || !state.handlers.length) return null
  return (
    <div data-mcp-app-open-with-actions="" className="mt-1 flex max-w-full flex-wrap justify-center gap-2 px-4">
      {state.handlers.map(handler => (
        <Button key={`${handler.server}:${handler.tool}`} variant="outline" size="sm" className="max-w-full" onClick={() => open(handler, props.absolutePath, route)}>
          <HandlerIcon handler={handler} />
          <span className="min-w-0 truncate">{t('mcpApp.openWithApp', { app: handler.title })}</span>
        </Button>
      ))}
    </div>
  )
}

function HandlerIcon({ handler }: { handler: McpAppFileHandler }) {
  return <McpAppIcon src={handler.icon} className="size-3.5 shrink-0" fallback={<AppWindow className="size-3.5 shrink-0" />} />
}
