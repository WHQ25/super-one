import { ChevronRight, Laptop, Loader2, Monitor, Plus, RotateCw, Server, TriangleAlert, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { EnvironmentConnection, EnvironmentKind, LoadStatus } from '@/lib/multi-host/types'
import { HostConnectionToggle } from '@/components/sidebar/HostConnectionToggle'

export function EnvironmentKindIcon({ kind, className = 'size-3.5 shrink-0' }: { kind: EnvironmentKind; className?: string }) {
  if (kind === 'cli-node') return <Server className={className} aria-hidden />
  if (kind === 'remote-desktop') return <Laptop className={className} aria-hidden />
  return <Monitor className={className} aria-hidden />
}

export function EnvironmentSectionHeader({
  label,
  kind,
  connection,
  expanded,
  projectsStatus,
  projectsError,
  refreshing = false,
  connectionBusy = false,
  onToggle,
  onRefresh,
  onToggleConnection,
  onAddProject,
}: {
  label: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  expanded: boolean
  projectsStatus: LoadStatus
  projectsError: string | null
  refreshing?: boolean
  connectionBusy?: boolean
  onToggle: () => void
  onRefresh?: () => void
  onToggleConnection?: () => void
  onAddProject?: () => void
}) {
  const { t } = useTranslation()
  const offline = connection === 'offline'
  const connecting = connection === 'connecting' || projectsStatus === 'loading'
  const remote = kind !== 'local'

  return (
    <div className={cn('flex flex-col', offline && 'opacity-70')} data-environment-connection={connection}>
      <div className="group flex h-8 items-center gap-1 overflow-hidden rounded-md px-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 text-left text-sm font-medium text-sidebar-foreground"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <ChevronRight className={cn('size-3.5 shrink-0 text-sidebar-foreground/70 transition-transform', expanded && 'rotate-90')} />
          <EnvironmentKindIcon kind={kind} />
          <span className="truncate">{label}</span>
          {offline && <Unplug className="size-3 shrink-0" aria-label={t('sidebar.hover.offline')} />}
          {connection === 'needs-upgrade' && (
            <TriangleAlert className="size-3 shrink-0 text-warning" aria-label={t('sidebar.hover.needsUpgrade')} />
          )}
          {connecting && !offline && <Loader2 className="size-3 shrink-0 animate-spin" aria-label={t('sidebar.hover.connecting')} />}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {onAddProject && (
            <IconButton size="sm" tooltip={t('sidebar.addProject.title')} onClick={onAddProject}>
              <Plus />
            </IconButton>
          )}
          {remote && onRefresh && (
            <IconButton
              size="sm"
              tooltip={t('common.refresh')}
              disabled={offline || refreshing}
              onClick={onRefresh}
            >
              <RotateCw className={cn('size-3', refreshing && 'animate-spin')} />
            </IconButton>
          )}
          {remote && onToggleConnection && (
            <HostConnectionToggle
              connected={!offline && (connection === 'connected' || connection === 'needs-upgrade' || connection === 'connecting')}
              busy={connectionBusy}
              spinning={connection === 'connecting'}
              onToggle={onToggleConnection}
            />
          )}
        </div>
      </div>
      {expanded && projectsStatus === 'error' && (
        <div className="px-6 pb-1 text-[11px] text-sidebar-foreground/70">
          <button type="button" className="underline" onClick={onRefresh}>{t('common.retry')}</button>
          {projectsError ? <span className="ml-1 break-all">{projectsError}</span> : null}
        </div>
      )}
    </div>
  )
}
