import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Folder, FolderOpen, Pencil, Search, SquarePen, Trash2 } from 'lucide-react'
import type { RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { checkoutToRecentFolder } from '@/lib/multi-host/checkout-folder'
import { environmentSections, groupCheckoutsByRepo, sortProjectGroups } from '@/lib/multi-host/group-projects'
import { knownSessionCount, projectHoverFolders } from '@/lib/multi-host/project-hover'
import { presenterFor } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket, HostCheckout, SidebarGroupBy, SidebarSort } from '@/lib/multi-host/types'
import { AutomationDialog } from '@/components/AutomationDialog'
import { ProjectHistoryList } from '@/components/sidebar/ProjectHistoryList'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'
import { ProjectHoverCard } from '@/components/sidebar/multi-host/ProjectHoverCard'
import { SessionHoverCardTrigger } from '@/components/sidebar/multi-host/SessionHoverCard'
import { SidebarHoverChevron, sidebarRowActionsClass } from '@/components/sidebar/hover-disclosure'
import { EnvironmentSectionHeader } from './EnvironmentSectionHeader'

const EMPTY_SESSIONS: SessionHistoryEntry[] = []

interface MultiHostProjectListProps {
  environments: EnvironmentBucket[]
  groupBy: SidebarGroupBy
  sort: SidebarSort
  expandedProjectKeys: Set<string>
  collapsedEnvironmentIds: string[]
  folderSessions: Record<string, SessionHistoryEntry[]>
  folderSessionsHaveMore: Record<string, boolean>
  loadingFolders: Record<string, boolean>
  openingSession: { folderPath: string; sessionId: string } | null
  onToggleProject: (folderPath: string) => void
  onToggleEnvironment: (environmentId: string) => void
  onLoadMoreSessions: (folderPath: string, minimumRootCount: number) => Promise<SessionHistoryEntry[]>
  onSwitchSession: (folderPath: string, sessionId: string) => void
  onPinSession: (sessionId: string, pinned: boolean, folderPath: string) => void
  onHideSession: (sessionId: string, hidden: boolean, folderPath: string) => void
  onRenameSession: (target: { sessionId: string; title: string; folderPath: string }) => void
  onDeleteSession: (target: { sessionId: string; title: string; folderPath: string; provider: import('@superone/shared/agent-types').HarnessId }) => void
  onEditProject: (folder: RecentFolder) => void
  onRemoveProject: (folder: RecentFolder) => void
  onNewSession: (folderPath: string) => void
  onRefreshEnvironment: (connectionId: string) => void
  onToggleConnection: (connectionId: string, connection: EnvironmentBucket['connection']) => void
  onAddProject: (connectionId: string) => void
  onSort?: (sort: SidebarSort) => void
  connectionBusyId: string | null
  refreshingConnectionId: string | null
}

function preferredCheckout(checkouts: HostCheckout[]): HostCheckout {
  const local = checkouts.find((checkout) => checkout.connectionId === 'local')
  if (local) return local
  return checkouts.reduce((best, checkout) => (checkout.lastOpened > best.lastOpened ? checkout : best))
}

function ProjectLoadError({
  bucket,
  className,
  showLabel = false,
  onRetry,
}: {
  bucket: EnvironmentBucket
  className: string
  showLabel?: boolean
  onRetry: (connectionId: string) => void
}) {
  const { t } = useTranslation()
  const retry = t('sidebar.environmentSection.loadFailed')
  return (
    <button
      type="button"
      className={className}
      title={bucket.projectsError ?? undefined}
      onClick={() => onRetry(bucket.connectionId)}
    >
      {showLabel ? `${bucket.label}: ${retry}` : retry}
    </button>
  )
}

export function MultiHostProjectList(props: MultiHostProjectListProps) {
  const { t } = useTranslation()
  const {
    environments, groupBy, sort, expandedProjectKeys, collapsedEnvironmentIds,
  } = props

  const checkoutRow = (checkout: HostCheckout, bucket: EnvironmentBucket, name?: string, sessionsOnly = false) => {
    const folder = checkoutToRecentFolder(checkout, name)
    return (
      <ProjectSidebarRow
        key={checkout.pathKey}
        folder={folder}
        sessionsOnly={sessionsOnly}
        isExpanded={expandedProjectKeys.has(checkout.pathKey)}
        sessions={props.folderSessions[checkout.pathKey] ?? EMPTY_SESSIONS}
        sessionsLoading={props.loadingFolders[checkout.pathKey] === true}
        openingSessionId={props.openingSession?.folderPath === checkout.pathKey ? props.openingSession.sessionId : null}
        hasMoreSessions={props.folderSessionsHaveMore[checkout.pathKey] ?? false}
        onLoadMoreSessions={props.onLoadMoreSessions}
        onToggleExpand={props.onToggleProject}
        onSwitchSession={props.onSwitchSession}
        onPinSession={props.onPinSession}
        onHideSession={props.onHideSession}
        onEditProject={props.onEditProject}
        onRemoveProject={props.onRemoveProject}
        onRenameSession={props.onRenameSession}
        onDeleteSession={props.onDeleteSession}
        onNewSession={props.onNewSession}
        offline={bucket.connection === 'offline'}
        repoIdentity={checkout.repoIdentity}
        sessionsLoaded={checkout.pathKey in props.folderSessions}
        sessionPresentation={presenterFor(bucket, folder.name, folder.path)}
      />
    )
  }

  if (groupBy === 'environment') {
    const sections = environmentSections(environments, sort)
    return (
      <div className="flex w-0 min-w-full flex-col px-2 pb-1.5">
        {sections.map(({ bucket, checkouts }) => {
          const offline = bucket.connection === 'offline'
          const collapsed = collapsedEnvironmentIds.includes(bucket.environmentId)
          const expanded = !offline && !collapsed
          return (
            <div key={bucket.environmentId} data-environment-id={bucket.environmentId}>
              <EnvironmentHeader
                bucket={bucket}
                expanded={expanded}
                refreshing={props.refreshingConnectionId === bucket.connectionId}
                connectionBusy={props.connectionBusyId === bucket.connectionId}
                sort={sort}
                onToggle={() => {
                  if (offline) return
                  props.onToggleEnvironment(bucket.environmentId)
                }}
                onRefresh={() => props.onRefreshEnvironment(bucket.connectionId)}
                onToggleConnection={() => props.onToggleConnection(bucket.connectionId, bucket.connection)}
                onAddProject={() => props.onAddProject(bucket.connectionId)}
                onSort={props.onSort}
              />
              {/* Projects sit one step inside their environment, hover fill included. */}
              <div className="pl-1">
                {expanded && bucket.projectsStatus === 'loading' && checkouts.length === 0 && (
                  <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>
                )}
                {expanded && bucket.projectsStatus === 'error' && checkouts.length === 0 && (
                  <ProjectLoadError
                    bucket={bucket}
                    className="px-2.5 py-2 text-left text-xs text-sidebar-foreground/70"
                    onRetry={props.onRefreshEnvironment}
                  />
                )}
                {expanded && bucket.projectsStatus === 'ready' && checkouts.length === 0 && bucket.connection !== 'offline' && (
                  <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.environmentSection.empty')}</div>
                )}
                {expanded && checkouts.map((checkout) => checkoutRow(checkout, bucket))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const groups = sortProjectGroups(
    groupCheckoutsByRepo(environments.flatMap((bucket) => bucket.checkouts)),
    sort,
  )
  const errors = environments.filter((bucket) => bucket.projectsStatus === 'error')
  return (
    <div className="flex w-0 min-w-full flex-col px-2 pb-1.5">
      {errors.map((bucket) => (
        <ProjectLoadError
          key={bucket.environmentId}
          bucket={bucket}
          className="px-2 py-1 text-left text-[11px] text-sidebar-foreground/70"
          showLabel
          onRetry={props.onRefreshEnvironment}
        />
      ))}
      {groups.map((group) => {
        if (group.checkouts.length === 1) {
          const checkout = group.checkouts[0]!
          const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
          if (!bucket) return null
          return checkoutRow(checkout, bucket)
        }
        const groupKey = `group:${group.key}`
        const allOffline = group.checkouts.every((checkout) => (
          environments.find((item) => item.environmentId === checkout.environmentId)?.connection === 'offline'
        ))
        const open = !allOffline && expandedProjectKeys.has(groupKey)
        const loadingAny = group.checkouts.some((checkout) => props.loadingFolders[checkout.pathKey] === true)
        const anySessions = group.checkouts.some((checkout) => (props.folderSessions[checkout.pathKey]?.length ?? 0) > 0)
        const target = preferredCheckout(group.checkouts)
        return (
          <RepoGroupHeader
            key={group.key}
            name={group.name}
            open={open}
            locked={allOffline}
            checkouts={group.checkouts}
            environments={environments}
            folderSessions={props.folderSessions}
            folderSessionsHaveMore={props.folderSessionsHaveMore}
            onToggle={() => {
              if (allOffline) return
              props.onToggleProject(groupKey)
              if (!open) {
                for (const checkout of group.checkouts) {
                  if (!expandedProjectKeys.has(checkout.pathKey)) props.onToggleProject(checkout.pathKey)
                }
              }
            }}
            onNewSession={() => props.onNewSession(target.pathKey)}
            onEdit={props.onEditProject}
            onRemove={props.onRemoveProject}
            onSwitchSession={props.onSwitchSession}
            onPinSession={props.onPinSession}
            onHideSession={props.onHideSession}
            onRenameSession={props.onRenameSession}
            onDeleteSession={props.onDeleteSession}
            openingSessionId={props.openingSession?.folderPath === target.pathKey ? props.openingSession.sessionId : null}
            initialSessions={props.folderSessions[target.pathKey]}
          >
            {open && group.checkouts.map((checkout) => {
              const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
              if (!bucket) return null
              return checkoutRow(checkout, bucket, undefined, true)
            })}
            {open && !loadingAny && !anySessions && (
              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>
            )}
          </RepoGroupHeader>
        )
      })}
      {groups.length === 0 && errors.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-sidebar-foreground/70">
          {t('sidebar.empty')}
        </div>
      )}
    </div>
  )
}

function EnvironmentHeader({
  bucket, expanded, refreshing, connectionBusy, sort, onToggle, onRefresh, onToggleConnection, onAddProject, onSort,
}: {
  bucket: EnvironmentBucket
  expanded: boolean
  refreshing: boolean
  connectionBusy: boolean
  sort: SidebarSort
  onToggle: () => void
  onRefresh: () => void
  onToggleConnection: () => void
  onAddProject: () => void
  onSort?: (sort: SidebarSort) => void
}) {
  return (
    <EnvironmentSectionHeader
      label={bucket.label}
      kind={bucket.kind}
      connection={bucket.connection}
      path={bucket.path}
      expanded={expanded}
      projectsStatus={bucket.projectsStatus}
      projectsError={bucket.projectsError}
      refreshing={refreshing}
      connectionBusy={connectionBusy}
      sort={sort}
      onToggle={onToggle}
      onRefresh={bucket.kind === 'local' ? undefined : onRefresh}
      onToggleConnection={bucket.kind === 'local' ? undefined : onToggleConnection}
      onAddProject={onAddProject}
      onSort={onSort}
    />
  )
}

function RepoGroupHeader({
  name, open, locked = false, checkouts, environments, folderSessions, folderSessionsHaveMore,
  onToggle, onNewSession, onEdit, onRemove,
  onSwitchSession, onPinSession, onHideSession, onRenameSession, onDeleteSession,
  openingSessionId, initialSessions, children,
}: {
  name: string
  open: boolean
  /** Every checkout's environment is offline, so the group has nothing to open. */
  locked?: boolean
  checkouts: HostCheckout[]
  environments: EnvironmentBucket[]
  folderSessions: Record<string, SessionHistoryEntry[]>
  folderSessionsHaveMore: Record<string, boolean>
  onToggle: () => void
  onNewSession: () => void
  onEdit: (folder: RecentFolder) => void
  onRemove: (folder: RecentFolder) => void
  onSwitchSession: MultiHostProjectListProps['onSwitchSession']
  onPinSession: MultiHostProjectListProps['onPinSession']
  onHideSession: MultiHostProjectListProps['onHideSession']
  onRenameSession: MultiHostProjectListProps['onRenameSession']
  onDeleteSession: MultiHostProjectListProps['onDeleteSession']
  openingSessionId: string | null
  initialSessions: SessionHistoryEntry[] | undefined
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [history, setHistory] = useState(false)
  const [automationOpen, setAutomationOpen] = useState(false)
  const target = preferredCheckout(checkouts)
  const targetLabel = (checkout: HostCheckout) => {
    const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
    return t('sidebar.actionTarget', { environment: bucket?.label ?? checkout.connectionId, path: checkout.hostPath })
  }
  const localCheckouts = checkouts.filter((checkout) => checkout.connectionId === 'local' && !checkout.missing)
  const openCheckout = (checkout: HostCheckout) => window.app.showInFolder(checkout.hostPath, '')
  const items: AdaptiveMenuEntry[] = [
    {
      kind: 'submenu',
      id: 'edit-project',
      label: t('sidebar.contextMenu.editProject'),
      icon: Pencil,
      items: checkouts.map((checkout) => ({
        kind: 'item' as const,
        id: `edit-${checkout.environmentId}-${checkout.projectId}`,
        label: targetLabel(checkout),
        onSelect: () => onEdit(checkoutToRecentFolder(checkout)),
      })),
    },
    ...(localCheckouts.length === 1
      ? [{
          kind: 'item' as const,
          id: 'open-folder',
          label: t('sidebar.contextMenu.openFolder'),
          icon: FolderOpen,
          onSelect: () => openCheckout(localCheckouts[0]!),
        }]
      : localCheckouts.length > 1
        ? [{
            kind: 'submenu' as const,
            id: 'open-folder',
            label: t('sidebar.contextMenu.openFolder'),
            icon: FolderOpen,
            items: localCheckouts.map((checkout) => ({
              kind: 'item' as const,
              id: `open-${checkout.environmentId}-${checkout.projectId}`,
              label: targetLabel(checkout),
              onSelect: () => openCheckout(checkout),
            })),
          }]
        : []),
    {
      kind: 'submenu',
      id: 'remove-project',
      label: t('sidebar.contextMenu.removeProject'),
      icon: Trash2,
      items: checkouts.map((checkout) => ({
        kind: 'item' as const,
        id: `remove-${checkout.environmentId}-${checkout.projectId}`,
        label: targetLabel(checkout),
        destructive: true,
        onSelect: () => onRemove(checkoutToRecentFolder(checkout)),
      })),
    },
  ]
  const sessionCount = checkouts.reduce<number | null>((sum, checkout) => {
    if (sum == null) return null
    const count = knownSessionCount({
      loaded: checkout.pathKey in folderSessions,
      hasMore: folderSessionsHaveMore[checkout.pathKey] === true,
      sessions: folderSessions[checkout.pathKey] ?? [],
    })
    return count == null ? null : sum + count
  }, 0)
  const localFolderPaths = new Set(
    localCheckouts.flatMap((checkout) => [checkout.hostPath, ...(checkout.extraDirs ?? [])]),
  )
  const hoverFolders = projectHoverFolders(
    target.hostPath,
    checkouts.flatMap((checkout) => [checkout.hostPath, ...(checkout.extraDirs ?? [])].filter((path) => path !== target.hostPath)),
  ).map((folder) => ({ ...folder, openable: localFolderPaths.has(folder.path) }))
  return (
    <div>
      <ProjectHoverCard
        name={name}
        repoIdentity={target.repoIdentity}
        folders={hoverFolders}
        sessionCount={sessionCount}
        sessionPaths={checkouts.map((checkout) => checkout.pathKey)}
        offline={locked}
        onEdit={checkouts.length === 1 ? () => onEdit(checkoutToRecentFolder(target)) : undefined}
        edits={checkouts.length > 1 ? checkouts.map((checkout) => ({
          id: `${checkout.environmentId}-${checkout.projectId}`,
          label: targetLabel(checkout),
          onSelect: () => onEdit(checkoutToRecentFolder(checkout)),
        })) : undefined}
      >
      <AdaptiveContextMenu items={items} contentClassName="w-56">
        <SessionHoverCardTrigger>
        <div className={cn('group flex h-9 w-full items-center overflow-hidden rounded-md pl-2.5 pr-1.5 transition-colors', locked ? 'cursor-default opacity-60' : 'hover:bg-sidebar-hover')}>
          {locked ? (
            <div className="flex min-w-0 flex-1 items-center text-left">
              <SidebarHoverChevron
                expanded={false}
                locked
                glyph={<Folder className="size-4 shrink-0 text-sidebar-foreground/70" />}
              />
              <span className="ml-2 min-w-0 truncate text-md">{name}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (history) setHistory(false)
                onToggle()
              }}
              className="flex min-w-0 flex-1 items-center text-left"
            >
              <SidebarHoverChevron
                expanded={open}
                glyph={open
                  ? <FolderOpen className="size-4 shrink-0 text-sidebar-foreground/70" />
                  : <Folder className="size-4 shrink-0 text-sidebar-foreground/70" />}
              />
              <span className="ml-2 min-w-0 truncate text-md">{name}</span>
            </button>
          )}
          {!locked && (
          <div
            data-slot="project-row-actions"
            className={sidebarRowActionsClass}
          >
            <IconButton
              size="sm"
              variant="nested"
              tooltip={t('sidebar.contextMenu.searchSessions')}
              tooltipSideOffset={8}
              onClick={(event) => {
                event.stopPropagation()
                setHistory(true)
              }}
            >
              <Search />
            </IconButton>
            <IconButton
              size="sm"
              variant="nested"
              tooltip={t('tooltips.newAutomation')}
              tooltipSideOffset={8}
              onClick={(event) => {
                event.stopPropagation()
                setAutomationOpen(true)
              }}
            >
              <CalendarClock />
            </IconButton>
            <IconButton
              size="sm"
              variant="nested"
              tooltip={t('tooltips.newSession')}
              tooltipSideOffset={8}
              onClick={(event) => {
                event.stopPropagation()
                onNewSession()
              }}
            >
              <SquarePen />
            </IconButton>
          </div>
          )}
        </div>
        </SessionHoverCardTrigger>
      </AdaptiveContextMenu>
      </ProjectHoverCard>
      <div className="pl-1">
        {!locked && history ? (
          <ProjectHistoryList
            folderPath={target.pathKey}
            initialSessions={initialSessions}
            openingSessionId={openingSessionId}
            onClose={() => setHistory(false)}
            onSwitchSession={onSwitchSession}
            onPinSession={onPinSession}
            onHideSession={onHideSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        ) : children}
      </div>
      <AutomationDialog
        open={automationOpen}
        onOpenChange={setAutomationOpen}
        editAutomation={null}
        projectPath={target.pathKey}
      />
    </div>
  )
}
