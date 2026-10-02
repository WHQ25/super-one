import { AppWindow, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { McpAppFileHandler } from '@superone/shared/mcp-app-files'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import type { SessionScope } from '@/stores/chat-store/session-scope'
import { openFileWithMcpApp, prefetchMcpAppFileHandlers, useMcpAppFileHandlers, useMcpAppFileRoute } from './file-apps'
import type { McpAppRoute } from './desktop-executor'

/** Open a file in an App and report failure; the shared action behind every "Open With" entry. */
export function useOpenFileWithMcpApp(): (handler: McpAppFileHandler, absolutePath: string, route: McpAppRoute | null) => void {
  const { t } = useTranslation()
  return (handler, absolutePath, route) => {
    if (!route) return
    const name = absolutePath.split(/[/\\]/).pop() ?? absolutePath
    openFileWithMcpApp(route, handler, absolutePath).catch((error: unknown) => {
      toast.error(t('mcpApp.openFileFailed', { name, error: error instanceof Error ? error.message : String(error) }))
    })
  }
}

/**
 * "Open With ▸ SuperOne Preview / <App>…". Present only once at least one App in the
 * pane's session declares a file entrypoint for this extension: SuperOne's own
 * preview stays the default, and the menu does not grow for files no App opens.
 */
export function useOpenWithMenu(absolutePath: string | null | undefined, options: { scope: SessionScope | null; openInSuperOne: () => void }): { entries: AdaptiveMenuEntry[]; prefetch: () => void } {
  const { t } = useTranslation()
  const route = useMcpAppFileRoute(options.scope)
  const state = useMcpAppFileHandlers(route, absolutePath)
  const open = useOpenFileWithMcpApp()
  const prefetch = () => { if (absolutePath) prefetchMcpAppFileHandlers(route, absolutePath) }
  if (!absolutePath || state?.status !== 'ready' || !state.handlers.length) return { entries: [], prefetch }
  return { prefetch, entries: [{
    kind: 'submenu', id: 'openWith', label: t('mcpApp.openWith'), icon: AppWindow,
    items: [
      { kind: 'item', id: 'openWith:superone', label: t('mcpApp.superOnePreview'), icon: Eye, onSelect: options.openInSuperOne },
      { kind: 'separator' },
      ...state.handlers.map(handler => ({
        kind: 'item' as const, id: `openWith:${handler.server}:${handler.tool}`, label: handler.title, icon: AppWindow,
        onSelect: () => open(handler, absolutePath, route),
      })),
    ],
  }] }
}
