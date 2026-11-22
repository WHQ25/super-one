import { useState } from 'react'
import { ArrowDownUp, Bell, Plus, RotateCw, TriangleAlert } from 'lucide-react'
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
import { environmentUnreachable } from '@/lib/multi-host/unreachable-error'
import { HostConnectionToggle } from '@/components/sidebar/HostConnectionToggle'
import { SidebarHoverChevron, sidebarRowActionsClass } from '@/components/sidebar/hover-disclosure'
import { EnvironmentKindIcon, EnvironmentUpgradingIcon } from './EnvironmentKindIcon'
import { EnvironmentHoverCard, type EnvironmentHoverDetails } from './EnvironmentHoverCard'
import { sidebarHoverCardRowClass } from './SidebarHoverCard'

export { EnvironmentKindIcon }

export function EnvironmentRowActions({
  offline,
  remote,
  connection,
  refreshing,
  connectionBusy,
  sort,
  onSort,
  onAddProject,
  onRefresh,
  onToggleConnection,
  upgrading = false,
  unreachable = false,
  resident = false,
}: {
  offline: boolean
  remote: boolean
  connection: EnvironmentConnection
  refreshing: boolean
  connectionBusy: boolean
  sort?: SidebarSort
  onSort?: (sort: SidebarSort) => void
  onAddProject?: () => void
  onRefresh?: () => void
  onToggleConnection?: () => void
  /** The CLI install owns this node. Hide connect, refresh, and add until it finishes. */
  upgrading?: boolean
  /**
   * The socket is down while the supervisor still lists the host as live.
   * Keep refresh and disconnect; hide catalog actions.
   */
  unreachable?: boolean
  /** Focus mode keeps these icons on screen. The row still reveals them on hover. */
  resident?: boolean
}) {
  const { t } = useTranslation()
  const [sortOpen, setSortOpen] = useState(false)
  const unavailable = offline || upgrading
  const catalog = !unavailable && !unreachable
  return (
    <div
      data-slot="environment-row-actions"
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        resident ? 'flex shrink-0 items-center gap-0.5' : sidebarRowActionsClass,
        !resident && sortOpen && 'pointer-events-auto visible w-auto opacity-100',
      )}
    >
      {catalog && onSort && (
        <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" variant="nested" aria-label={t('sidebar.sort.title')}>
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
      {catalog && onAddProject && (
        <IconButton size="sm" variant="nested" aria-label={t('sidebar.addProject.title')} onClick={onAddProject}>
          <Plus />
        </IconButton>
      )}
      {remote && !unavailable && onRefresh && (
        <IconButton
          size="sm"
          variant="nested"
          aria-label={t('common.refresh')}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RotateCw className={cn(refreshing && 'animate-spin')} />
        </IconButton>
      )}
      {remote && !upgrading && onToggleConnection && (
        <HostConnectionToggle
          variant="nested"
          showTooltip={false}
          connected={!offline && (connection === 'connected' || connection === 'needs-upgrade' || connection === 'connecting')}
          busy={connectionBusy}
          spinning={connection === 'connecting'}
          onToggle={onToggleConnection}
        />
      )}
    </div>
  )
}

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
  onEnterFocus,
  obscured = false,
  connectionId,
  projectCount = null,
  onRename,
  cardOpen,
  details,
  upgradingLabel,
  attentionCount = 0,
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
  /** Double-click gives this environment the list pane under the app drawer. */
  onEnterFocus?: () => void
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
  /** Set while this desktop is installing the node's CLI. The leading glyph becomes the loading bars. */
  upgradingLabel?: string
  attentionCount?: number
}) {
  const { t } = useTranslation()
  const offline = connection === 'offline'
  const upgrading = Boolean(upgradingLabel)
  const unreachable = environmentUnreachable({ connection, projectsStatus, projectsError })
  const remote = kind !== 'local'
  const quiet = offline || unreachable
  const open = expanded && !quiet
  const labelClass = 'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm font-medium text-sidebar-foreground'
  const disclosure = (
    <>
      <SidebarHoverChevron
        expanded={open}
        locked={quiet || upgrading}
        glyph={upgradingLabel
          ? <EnvironmentUpgradingIcon label={upgradingLabel} />
          : <EnvironmentKindIcon kind={kind} connection={connection} path={path} unreachable={unreachable} />}
      />
      <span className="truncate">{label}</span>
      {!open && attentionCount > 0 && (
        <span
          data-slot="environment-attention-count"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sidebar-foreground/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-sidebar-foreground/80 tabular-nums"
        >
          <Bell className="size-3 shrink-0" />
          <span>{attentionCount}</span>
        </span>
      )}
      {connection === 'needs-upgrade' && !upgrading && !unreachable && (
        <TriangleAlert className="size-3 shrink-0 text-warning" aria-label={t('sidebar.hover.needsUpgrade')} />
      )}
    </>
  )

  return (
    <div
      data-slot="environment-section-header"
      data-environment-connection={connection}
      className={cn(offline && !upgrading && 'opacity-70', obscured && 'invisible')}
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
        statusLabel={upgrading ? t('sidebar.hover.upgrading') : unreachable ? t('sidebar.hover.offline') : undefined}
        unreachable={unreachable}
      >
      <div
        onDoubleClick={(event) => {
          if (!onEnterFocus) return
          event.stopPropagation()
          onEnterFocus()
        }}
        className={cn(
          'group flex h-9 items-center gap-1 overflow-hidden rounded-md px-1.5 transition-colors',
          sidebarHoverCardRowClass,
          !quiet && 'cursor-pointer',
        )}
      >
        {quiet ? (
          <div className={labelClass}>{disclosure}</div>
        ) : (
          <button type="button" className={labelClass} onClick={onToggle} aria-expanded={expanded}>
            {disclosure}
          </button>
        )}
        <EnvironmentRowActions
          offline={offline}
          remote={remote}
          connection={connection}
          refreshing={refreshing}
          connectionBusy={connectionBusy}
          sort={sort}
          onSort={onSort}
          onAddProject={onAddProject}
          onRefresh={onRefresh}
          onToggleConnection={onToggleConnection}
          upgrading={upgrading}
          unreachable={unreachable}
        />
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
