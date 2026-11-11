import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, Maximize, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { mcpAppPresentationIcon } from '@superone/shared/mcp-apps-metadata'
import type { McpAppEntrypointDescriptor } from '@superone/shared/mcp-app-entrypoints'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { MarqueeText } from '@superone/ui/components/ui/marquee-text'
import { cn } from '@superone/ui/lib/utils'
import { ToolBrandIcon } from '@/components/chat/ToolIcon'
import { getToolDisplay } from '@/components/chat/tool-display'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { useIsDark } from '@/hooks/use-is-dark'
import {
  loadGlobalMcpAppEntrypoints,
  openMcpAppFromDrawer,
  prefetchThreadMcpAppEntrypoints,
  useVisibleMcpAppEntrypoints,
} from '@/components/mcp-apps/entrypoint-apps'

function EntrypointAppIcon({ item, sizeClass }: { item: McpAppEntrypointDescriptor; sizeClass: string }) {
  const isDark = useIsDark()
  const fallbackIcon = useMcpServerIcon(item.server)
  const icon = mcpAppPresentationIcon(
    { toolTitle: item.title, serverTitle: item.serverTitle, icons: item.icons },
    isDark ? 'dark' : 'light',
  ) ?? item.icon ?? fallbackIcon
  const fallback = getToolDisplay(`mcp__${item.server}__${item.tool}`, {}).icon
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-md bg-sidebar-hover/60', sizeClass)}>
      <ToolBrandIcon src={icon} alt={item.serverTitle ?? item.server} icon={fallback} />
    </span>
  )
}

export interface GlobalMcpAppsListProps {
  entrypoints: McpAppEntrypointDescriptor[]
  loading?: boolean
  incomplete?: boolean
  compact?: boolean
  divided?: boolean
  search?: string
  onOpen: (item: McpAppEntrypointDescriptor, maximized: boolean) => void
  onRefresh: () => void
}

export function GlobalMcpAppsList({
  entrypoints,
  loading = false,
  incomplete = false,
  compact = false,
  divided = false,
  search = '',
  onOpen,
  onRefresh,
}: GlobalMcpAppsListProps) {
  const { t } = useTranslation()
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return entrypoints
    return entrypoints.filter(item =>
      item.title.toLowerCase().includes(query)
      || (item.serverTitle ?? item.server).toLowerCase().includes(query)
      || (item.description ?? '').toLowerCase().includes(query),
    )
  }, [entrypoints, search])

  if (!loading && !incomplete && filtered.length === 0) return null

  return (
    <div className={cn('flex flex-col', divided && 'mt-1 border-t border-sidebar-border/60 pt-1')}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-medium text-sidebar-foreground/50">
          {t('mcpApp.mcpAppsSection')}
        </span>
        <div className="flex items-center gap-1">
          {incomplete && !loading && (
            <span
              title={t('mcpApp.incompleteApps')}
              aria-label={t('mcpApp.incompleteApps')}
              className="inline-flex items-center text-amber-500"
            >
              <AlertCircle className="size-3" />
            </span>
          )}
          <IconButton
            size="sm"
            variant="nested"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation()
              onRefresh()
            }}
            tooltip={t('mcpApp.discoverApps')}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RotateCw />}
          </IconButton>
        </div>
      </div>

      {filtered.map((item) => {
        const subtitle = item.description ?? item.serverTitle ?? item.server
        return (
          <div
            key={item.key}
            onClick={() => onOpen(item, false)}
            className="group/mcpapp flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-hover"
          >
            <EntrypointAppIcon item={item} sizeClass={compact ? 'size-6' : 'size-7'} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <span className="truncate text-[13px]">{item.title}</span>
              <MarqueeText className="text-[11px] text-sidebar-foreground/50">{subtitle}</MarqueeText>
            </div>
            <div className="ml-1 flex shrink-0 items-center gap-0.5">
              <IconButton
                size="sm"
                variant="nested"
                className="opacity-0 transition-all group-hover/mcpapp:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(item, true)
                }}
                tooltip={t('mcpApp.fullscreen')}
              >
                <Maximize />
              </IconButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function GlobalMcpAppsSection({
  projectPath,
  active,
  compact = false,
  divided = false,
  search = '',
  onAfterOpen,
}: {
  projectPath: string
  active: boolean
  compact?: boolean
  divided?: boolean
  search?: string
  onAfterOpen?: () => void
}) {
  const { t } = useTranslation()
  const { context, entrypoints, loading, incomplete } = useVisibleMcpAppEntrypoints(projectPath)
  const bucket = context.projectPath
  const isRemote = Boolean(bucket && parseRemoteProjectKey(bucket))
  const targetHarness = context.hasSession ? context.harness : null
  const supported = !isRemote && (!context.hasSession || Boolean(targetHarness))

  useEffect(() => {
    if (isRemote) return
    void loadGlobalMcpAppEntrypoints(bucket, { discover: false })
  }, [bucket, isRemote])

  useEffect(() => {
    if (!active || isRemote || !supported) return
    void loadGlobalMcpAppEntrypoints(bucket, {
      ...(targetHarness ? { harness: targetHarness } : {}),
      discover: true,
    })
    if (context.hasSession && context.sessionId && bucket && targetHarness) {
      prefetchThreadMcpAppEntrypoints({ projectPath: bucket, sessionId: context.sessionId }, { passive: true })
    }
  }, [active, bucket, isRemote, supported, targetHarness, context.hasSession, context.sessionId])

  if (!supported) return null

  return (
    <GlobalMcpAppsList
      entrypoints={entrypoints}
      loading={loading}
      incomplete={incomplete}
      compact={compact}
      divided={divided}
      search={search}
      onOpen={(item, maximized) => {
        onAfterOpen?.()
        void openMcpAppFromDrawer(context, item, maximized).catch((error: unknown) => {
          toast.error(t('mcpApp.openAppFailed', {
            app: item.title,
            error: error instanceof Error ? error.message : String(error),
          }))
        })
      }}
      onRefresh={() => {
        void loadGlobalMcpAppEntrypoints(bucket, {
          ...(targetHarness ? { harness: targetHarness } : {}),
          discover: true,
          forceRefresh: true,
        })
        if (context.hasSession && context.sessionId && bucket && targetHarness) {
          prefetchThreadMcpAppEntrypoints(
            { projectPath: bucket, sessionId: context.sessionId },
            { force: true, passive: true },
          )
        }
      }}
    />
  )
}
