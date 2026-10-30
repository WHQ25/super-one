import { useState } from 'react'
import { ArrowDownUp, Plus, RotateCw, TriangleAlert } from 'lucide-react'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { EnvironmentConnection, EnvironmentKind, LoadStatus, SidebarSort } from '@/lib/multi-host/types'
import { HostConnectionToggle } from '@/components/sidebar/HostConnectionToggle'
import { SidebarHoverChevron, sidebarRowActionsClass } from '@/components/sidebar/hover-disclosure'
import { EnvironmentKindIcon } from './EnvironmentKindIcon'
import { EnvironmentHoverCard, type EnvironmentHoverDetails } from './EnvironmentHoverCard'

export { EnvironmentKindIcon }

export function EnvironmentSectionHeader({
  label,
  kind,
  connection,
  path,
  expanded,
  projectsStatus,
  projectsError,
  refreshing = false,
  connectionBusy = false,
  onToggle,
  onRefresh,
  onToggleConnection,
  onAddProject,
  sort,
  onSort,
  obscured = false,
  connectionId,
  projectCount = null,
  onRename,
  cardOpen,
  details,
}: {
  label: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath
  expanded: boolean
  projectsStatus: LoadStatus
  projectsError: string | null
  refreshing?: boolean
  connectionBusy?: boolean
  onToggle: () => void
  onRefresh?: () => void
  onToggleConnection?: () => void
  onAddProject?: () => void
  sort?: SidebarSort
  onSort?: (sort: SidebarSort) => void
  /** The scrolling copy is covered by the unpainted pinned name. */
  obscured?: boolean
  connectionId?: string
  /** `null` until the project list has settled. */
  projectCount?: number | null
  /** Saves the name this computer shows for this environment. */
  onRename?: (name: string) => Promise<void>
  /** Stories pin the hover card open. */
  cardOpen?: boolean
  /** Skips the environment-list read. Stories pass the lines they draw. */
  details?: EnvironmentHoverDetails
}) {
  const { t } = useTranslation()
  const [sortOpen, setSortOpen] = useState(false)
  const offline = connection === 'offline'
  const remote = kind !== 'local'
  const open = expanded && !offline
  const labelClass = 'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm font-medium text-sidebar-foreground'
  const disclosure = (
    <>
      <SidebarHoverChevron
        expanded={open}
        locked={offline}
        glyph={<EnvironmentKindIcon kind={kind} connection={connection} path={path} />}
      />
      <span className="truncate">{label}</span>
      {connection === 'needs-upgrade' && (
        <TriangleAlert className="size-3 shrink-0 text-warning" aria-label={t('sidebar.hover.needsUpgrade')} />
      )}
    </>
  )

  return (
    <div
      data-slot="environment-section-header"
      data-environment-connection={connection}
      className={cn(offline && 'opacity-70', obscured && 'invisible')}
      aria-hidden={obscured || undefined}
      inert={obscured ? true : undefined}
    >
      <EnvironmentHoverCard
        open={cardOpen}
        label={label}
        kind={kind}
        connection={connection}
        path={path}
        projectCount={projectCount}
        connectionId={connectionId}
        details={details}
        onRename={onRename}
      >
      <div className={cn(
        'group flex h-9 items-center gap-1 overflow-hidden rounded-md px-1.5 transition-colors hover:bg-sidebar-hover',
        !offline && 'cursor-pointer',
      )}>
        {offline ? (
          <div className={labelClass}>{disclosure}</div>
        ) : (
          <button type="button" className={labelClass} onClick={onToggle} aria-expanded={expanded}>
            {disclosure}
          </button>
        )}
        <div
          data-slot="environment-row-actions"
          className={cn(sidebarRowActionsClass, sortOpen && 'pointer-events-auto visible w-auto opacity-100')}
        >
          {!offline && onSort && (
            <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" variant="nested" tooltip={t('sidebar.sort.title')}>
                  <ArrowDownUp />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onSort('recent')} className="text-xs">
                  {sort === 'recent' ? '✓ ' : '   '}{t('sidebar.sort.recent')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSort('added')} className="text-xs">
                  {sort === 'added' ? '✓ ' : '   '}{t('sidebar.sort.added')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!offline && onAddProject && (
            <IconButton size="sm" variant="nested" tooltip={t('sidebar.addProject.title')} onClick={onAddProject}>
              <Plus />
            </IconButton>
          )}
          {remote && !offline && onRefresh && (
            <IconButton
              size="sm"
              variant="nested"
              tooltip={t('common.refresh')}
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RotateCw className={cn(refreshing && 'animate-spin')} />
            </IconButton>
          )}
          {remote && onToggleConnection && (
            <HostConnectionToggle
              variant="nested"
              connected={!offline && (connection === 'connected' || connection === 'needs-upgrade' || connection === 'connecting')}
              busy={connectionBusy}
              spinning={connection === 'connecting'}
              onToggle={onToggleConnection}
            />
          )}
        </div>
      </div>
      </EnvironmentHoverCard>
      {open && projectsStatus === 'error' && (
        <div className="px-6 pb-1 text-[11px] text-sidebar-foreground/70">
          <button type="button" className="underline" onClick={onRefresh}>{t('common.retry')}</button>
          {projectsError ? <span className="ml-1 break-all">{projectsError}</span> : null}
        </div>
      )}
    </div>
  )
}
