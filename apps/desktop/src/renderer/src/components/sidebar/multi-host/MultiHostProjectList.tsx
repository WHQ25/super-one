import { useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarClock, Cloud, Folder, FolderOpen, Pencil, Search, SquarePen, Trash2 } from 'lucide-react'
import type { PinnedSessionEntry, RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { cn } from '@superone/ui/lib/utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { notifyEnvironmentListChanged } from '@/lib/environment-list'
import { checkoutToRecentFolder } from '@/lib/multi-host/checkout-folder'
import { environmentSections, groupCheckoutsByRepo, sortProjectGroups, type EnvironmentSection } from '@/lib/multi-host/group-projects'
import { projectHoverFolders } from '@/lib/multi-host/project-hover'
import { presenterFor } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket, HostCheckout, SidebarGroupBy, SidebarSort } from '@/lib/multi-host/types'
import { AutomationDialog } from '@/components/AutomationDialog'
import { ProjectHistoryList } from '@/components/sidebar/ProjectHistoryList'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'
import { SidebarCollapse, SidebarHeightMorph } from '@/components/sidebar/SidebarCollapse'
import { SidebarSectionLabel } from '@/components/sidebar/SidebarSectionLabel'
import { foldProjectSettled, useSidebarSectionCollapsed } from '@/components/sidebar/sidebar-section-collapse'
import { ProjectHoverCard } from '@/components/sidebar/multi-host/ProjectHoverCard'
import { SessionHoverCardTrigger, sidebarHoverCardRowClass } from '@/components/sidebar/multi-host/SessionHoverCard'
import { SidebarHoverChevron, sidebarRowActionsClass } from '@/components/sidebar/hover-disclosure'
import { EnvironmentSectionHeader } from './EnvironmentSectionHeader'
import { focusEnvironment } from '@/components/sidebar/sidebar-focus'
import { chainSessionListWheel, multiHostProjectListMaxHeights, SESSION_LIST_SCROLL_CLASS, type MultiHostSectionSize } from '@/components/sidebar/session-list-scroll'

const EMPTY_SESSIONS: SessionHistoryEntry[] = []
const EMPTY_SETTLED_SESSIONS: PinnedSessionEntry[] = []

export interface MultiHostProjectListProps {
  environments: EnvironmentBucket[]
  groupBy: SidebarGroupBy
  sort: SidebarSort
  expandedProjectKeys: Set<string>
  collapsedEnvironmentIds: string[]
  folderSessions: Record<string, SessionHistoryEntry[]>
  /** folder path → the active list has another page below the rows already shown. */
  sessionsHasMore?: Record<string, boolean>
  /** Scroll near the bottom of one project's active list loads its next page. */
  onLoadMoreSessions?: (folderPath: string) => void | Promise<void>
  /** folder path → parent id → children already loaded for that parent. */
  childSessions?: Record<string, Record<string, SessionHistoryEntry[]>>
  /** folder path → parent id → that child list has another page. */
  childSessionsHasMore?: Record<string, Record<string, boolean>>
  onLoadChildSessions?: (folderPath: string, parentSessionId: string) => void | Promise<void>
  onLoadMoreChildSessions?: (folderPath: string, parentSessionId: string) => void | Promise<void>
  /** Finished sessions across the loaded hosts. Each project keeps its own folder. */
  settledSessions?: PinnedSessionEntry[]
  /** folder path → another settled page is waiting below the rows already shown. */
  settledHasMore?: Record<string, boolean>
  /** folder path → settled sessions in that project, including pages not loaded yet. */
  settledCounts?: Record<string, number>
  onLoadMoreSettled?: (folderPath: string) => void | Promise<void>
  loadingFolders: Record<string, boolean>
  openingSession: { folderPath: string; sessionId: string } | null
  onToggleProject: (folderPath: string) => void
  onToggleEnvironment: (environmentId: string) => void
  onSwitchSession: (folderPath: string, sessionId: string, options?: { revealProject?: boolean }) => void
  onPinSession: (sessionId: string, pinned: boolean, folderPath: string) => void
  onSettleSession: (sessionId: string, settled: boolean, folderPath: string) => void
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
  /** connectionId → sentence for the leading spinner while that node's CLI installs. */
  upgradingLabels?: Readonly<Record<string, string>>
  /** In-flow names hidden while the unpainted pin shows them. */
  obscuredEnvironmentIds?: readonly string[]
  /**
   * Measured height of the multi-host scrollport. Unmeasured stays on `max-h-64`.
   * The scroll frame passes this; other callers leave it unset.
   */
  paneHeight?: number
  /** Focus mode: one environment's projects, with no environment header of their own. */
  flat?: boolean
}

function preferredCheckout(checkouts: HostCheckout[]): HostCheckout {
  const local = checkouts.find((checkout) => checkout.connectionId === 'local')
  if (local) return local
  return checkouts.reduce((best, checkout) => (checkout.lastOpened > best.lastOpened ? checkout : best))
}

function heightSections(
  environments: readonly EnvironmentBucket[],
  sort: SidebarSort,
  collapsedIds: ReadonlySet<string>,
  expandedProjectKeys: ReadonlySet<string>,
  folderSessions: Record<string, SessionHistoryEntry[]>,
  sessionsHasMore: Record<string, boolean> | undefined,
): MultiHostSectionSize[] {
  const sizes: MultiHostSectionSize[] = []
  for (const { bucket, checkouts } of environmentSections(environments, sort)) {
    if (bucket.connection === 'offline') continue
    const open = !collapsedIds.has(bucket.environmentId)
    const sessions = open ? checkouts.flatMap((checkout) => {
      if (!expandedProjectKeys.has(checkout.pathKey)) return []
      const sessionCount = folderSessions[checkout.pathKey]?.length ?? 0
      const hasMore = sessionsHasMore?.[checkout.pathKey] === true
      if (sessionCount === 0 && !hasMore) return []
      return [{ key: checkout.pathKey, sessionCount, hasMore }]
    }) : []
    sizes.push({ environmentId: bucket.environmentId, open, projectCount: checkouts.length, sessions })
  }
  return sizes
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
  const collapsedIds = new Set(collapsedEnvironmentIds)

  const environmentHeights = groupBy === 'environment' && !props.flat
    ? multiHostProjectListMaxHeights(
        heightSections(environments, sort, collapsedIds, expandedProjectKeys, props.folderSessions, props.sessionsHasMore),
        props.paneHeight ?? 0,
      )
    : null

  const checkoutRow = (checkout: HostCheckout, bucket: EnvironmentBucket, name?: string, sessionsOnly = false) => {
    const folder = checkoutToRecentFolder(checkout, name)
    return (
      <ProjectSidebarRow
        key={checkout.pathKey}
        folder={folder}
        sessionsOnly={sessionsOnly}
        isExpanded={expandedProjectKeys.has(checkout.pathKey)}
        sessionListMaxHeight={environmentHeights?.sessions.get(checkout.pathKey)}
        sessions={props.folderSessions[checkout.pathKey] ?? EMPTY_SESSIONS}
        sessionsHasMore={props.sessionsHasMore?.[checkout.pathKey] ?? false}
        onLoadMoreSessions={props.onLoadMoreSessions}
        childSessions={props.childSessions?.[checkout.pathKey]}
        childSessionsHasMore={props.childSessionsHasMore?.[checkout.pathKey]}
        onLoadChildSessions={props.onLoadChildSessions}
        onLoadMoreChildSessions={props.onLoadMoreChildSessions}
        settledSessions={props.settledSessions ?? EMPTY_SETTLED_SESSIONS}
        settledHasMore={props.settledHasMore?.[checkout.pathKey] ?? false}
        settledCount={props.settledCounts?.[checkout.pathKey]}
        onLoadMoreSettled={props.onLoadMoreSettled}
        sessionsLoading={props.loadingFolders[checkout.pathKey] === true}
        openingSessionId={props.openingSession?.folderPath === checkout.pathKey ? props.openingSession.sessionId : null}
        onToggleExpand={props.onToggleProject}
        onSwitchSession={props.onSwitchSession}
        onPinSession={props.onPinSession}
        onSettleSession={props.onSettleSession}
        onEditProject={props.onEditProject}
        onRemoveProject={props.onRemoveProject}
        onRenameSession={props.onRenameSession}
        onDeleteSession={props.onDeleteSession}
        onNewSession={props.onNewSession}
        offline={bucket.connection === 'offline'}
        repoIdentity={checkout.repoIdentity}
        sessionPresentation={presenterFor(bucket, folder.name, folder.path)}
        focusEnvironmentId={bucket.environmentId}
      />
    )
  }

  if (props.flat) {
    const sections = environmentSections(environments, sort)
    return (
      <div className="flex w-0 min-w-full flex-col px-2 pb-1.5 [&>*]:min-w-0">
        {sections.map(({ bucket, checkouts }) => (
          <div key={bucket.environmentId} data-environment-id={bucket.environmentId}>
            {bucket.projectsStatus === 'loading' && checkouts.length === 0 && (
              <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>
            )}
            {bucket.projectsStatus === 'error' && checkouts.length === 0 && (
              <ProjectLoadError
                bucket={bucket}
                className="px-2.5 py-2 text-left text-xs text-sidebar-foreground/70"
                onRetry={props.onRefreshEnvironment}
              />
            )}
            {checkouts.length === 0 && bucket.projectsStatus !== 'loading' && bucket.projectsStatus !== 'error' && (
              <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.environmentSection.empty')}</div>
            )}
            {checkouts.map((checkout) => checkoutRow(checkout, bucket))}
          </div>
        ))}
        {sections.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.environmentSection.empty')}</div>
        )}
      </div>
    )
  }

  if (groupBy === 'environment') {
    const sections = environmentSections(environments, sort).filter((section) => section.bucket.connection !== 'offline')
    return (
      <div className="flex w-0 min-w-full flex-col px-2 pb-1.5 [&>*]:min-w-0">
        {sections.map(({ bucket, checkouts }) => {
          const collapsed = collapsedEnvironmentIds.includes(bucket.environmentId)
          const projectMax = environmentHeights?.projects.get(bucket.environmentId)
          return (
            <div key={bucket.environmentId} data-environment-id={bucket.environmentId}>
              <EnvironmentHeader
                bucket={bucket}
                expanded={!collapsed}
                refreshing={props.refreshingConnectionId === bucket.connectionId}
                connectionBusy={props.connectionBusyId === bucket.connectionId}
                sort={sort}
                onToggle={() => props.onToggleEnvironment(bucket.environmentId)}
                onRefresh={() => props.onRefreshEnvironment(bucket.connectionId)}
                onToggleConnection={() => props.onToggleConnection(bucket.connectionId, bucket.connection)}
                onAddProject={() => props.onAddProject(bucket.connectionId)}
                onSort={props.onSort}
                obscured={props.obscuredEnvironmentIds?.includes(bucket.environmentId) ?? false}
                upgradingLabel={props.upgradingLabels?.[bucket.connectionId]}
              />
              {/* Projects sit one step inside their environment, hover fill included. */}
              <div className="pl-1">
                <SidebarCollapse open={!collapsed} unmountClosed>
                  <EnvironmentProjectScroll maxHeight={projectMax?.kind === 'px' ? projectMax.maxHeight : undefined}>
                    {bucket.projectsStatus === 'loading' && checkouts.length === 0 && (
                      <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>
                    )}
                    {bucket.projectsStatus === 'error' && checkouts.length === 0 && (
                      <ProjectLoadError
                        bucket={bucket}
                        className="px-2.5 py-2 text-left text-xs text-sidebar-foreground/70"
                        onRetry={props.onRefreshEnvironment}
                      />
                    )}
                    {bucket.projectsStatus === 'ready' && checkouts.length === 0 && (
                      <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.environmentSection.empty')}</div>
                    )}
                    {checkouts.map((checkout) => checkoutRow(checkout, bucket))}
                  </EnvironmentProjectScroll>
                </SidebarCollapse>
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
    <div className="flex w-0 min-w-full flex-col px-2 pb-1.5 [&>*]:min-w-0">
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
        const settled = props.settledSessions ?? EMPTY_SETTLED_SESSIONS
        const anySessions = group.checkouts.some((checkout) => (props.folderSessions[checkout.pathKey]?.length ?? 0) > 0)
        const anySettled = group.checkouts.some((checkout) => settled.some((session) => session.folderPath === checkout.pathKey))
        const target = preferredCheckout(group.checkouts)
        return (
          <RepoGroupHeader
            key={group.key}
            name={group.name}
            open={open}
            locked={allOffline}
            checkouts={group.checkouts}
            environments={environments}
            onToggle={() => {
              if (allOffline) return
              props.onToggleProject(groupKey)
              if (!open) {
                for (const checkout of group.checkouts) {
                  if (!expandedProjectKeys.has(checkout.pathKey)) props.onToggleProject(checkout.pathKey)
                }
              } else {
                // Checkout rows unmount while their own expand key stays set.
                for (const checkout of group.checkouts) foldProjectSettled(checkout.pathKey)
              }
            }}
            onNewSession={() => props.onNewSession(target.pathKey)}
            onEdit={props.onEditProject}
            onRemove={props.onRemoveProject}
            onSwitchSession={props.onSwitchSession}
            onPinSession={props.onPinSession}
            onSettleSession={props.onSettleSession}
            onRenameSession={props.onRenameSession}
            onDeleteSession={props.onDeleteSession}
            openingSessionId={props.openingSession?.folderPath === target.pathKey ? props.openingSession.sessionId : null}
            initialSessions={props.folderSessions[target.pathKey]}
          >
            {group.checkouts.map((checkout) => {
              const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
              if (!bucket) return null
              return checkoutRow(checkout, bucket, undefined, true)
            })}
            {!loadingAny && !anySessions && !anySettled && (
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

/**
 * Offline hosts, anchored under the host scroll. Opening the heading grows
 * the block upward. The host list uses the same `max-h-64` as one project's
 * Settled list outside focus.
 */
export function OfflineEnvironmentGroup({
  sections,
  sort,
  obscuredEnvironmentIds,
  refreshingConnectionId,
  connectionBusyId,
  upgradingLabels,
  onRefreshEnvironment,
  onToggleConnection,
  onAddProject,
  onSort,
}: {
  sections: readonly EnvironmentSection[]
  sort: SidebarSort
  obscuredEnvironmentIds?: readonly string[]
  refreshingConnectionId: string | null
  connectionBusyId: string | null
  upgradingLabels?: Readonly<Record<string, string>>
  onRefreshEnvironment: (connectionId: string) => void
  onToggleConnection: (connectionId: string, connection: EnvironmentBucket['connection']) => void
  onAddProject: (connectionId: string) => void
  onSort?: (sort: SidebarSort) => void
}) {
  const { t } = useTranslation()
  const [collapsed, toggle] = useSidebarSectionCollapsed('offline')
  const panelId = useId()
  const viewportRef = useRef<HTMLDivElement>(null)
  return (
    <div data-offline-environment-group="" className="flex shrink-0 flex-col px-2 pb-0.5">
      <SidebarSectionLabel
        section="offline"
        count={sections.length}
        countTone="plain"
        collapsed={collapsed}
        onToggle={toggle}
        controlsId={panelId}
        chevronWhenExpanded
        icon={<Cloud className="text-sidebar-foreground/45" />}
      >
        {t('sidebar.offlineEnvironments')}
      </SidebarSectionLabel>
      <SidebarCollapse id={panelId} open={!collapsed} unmountClosed>
        <ScrollArea
          type="scroll"
          edgeFade
          data-offline-environment-list=""
          viewportRef={viewportRef}
          className={SESSION_LIST_SCROLL_CLASS}
          onWheel={(event) => {
            if (viewportRef.current) chainSessionListWheel(viewportRef.current, event)
          }}
        >
          {sections.map(({ bucket }) => (
            <div key={bucket.environmentId} data-environment-id={bucket.environmentId}>
              <EnvironmentHeader
                bucket={bucket}
                expanded={false}
                refreshing={refreshingConnectionId === bucket.connectionId}
                connectionBusy={connectionBusyId === bucket.connectionId}
                sort={sort}
                onToggle={() => {}}
                onRefresh={() => onRefreshEnvironment(bucket.connectionId)}
                onToggleConnection={() => onToggleConnection(bucket.connectionId, bucket.connection)}
                onAddProject={() => onAddProject(bucket.connectionId)}
                onSort={onSort}
                obscured={obscuredEnvironmentIds?.includes(bucket.environmentId) ?? false}
                upgradingLabel={upgradingLabels?.[bucket.connectionId]}
              />
            </div>
          ))}
        </ScrollArea>
      </SidebarCollapse>
    </div>
  )
}

function EnvironmentProjectScroll({ children, maxHeight }: { children: ReactNode; maxHeight?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  return (
    <ScrollArea
      type="scroll"
      edgeFade
      data-environment-project-list=""
      className={SESSION_LIST_SCROLL_CLASS}
      style={maxHeight != null ? { maxHeight } : undefined}
      viewportRef={viewportRef}
      onWheel={(event) => {
        if (viewportRef.current) chainSessionListWheel(viewportRef.current, event)
      }}
    >
      {children}
    </ScrollArea>
  )
}

async function renameEnvironment(connectionId: string, name: string): Promise<void> {
  try {
    await window.environment.rename(connectionId, name)
    notifyEnvironmentListChanged(connectionId)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
    throw err
  }
}

export function EnvironmentHeader({
  bucket, expanded, refreshing, connectionBusy, sort, onToggle, onRefresh, onToggleConnection, onAddProject, onSort, obscured = false, upgradingLabel,
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
  obscured?: boolean
  /** Sentence announced by the leading spinner while this node's CLI installs. */
  upgradingLabel?: string
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
      obscured={obscured}
      connectionId={bucket.connectionId}
      projectCount={bucket.projectsStatus === 'ready' ? bucket.checkouts.length : null}
      onRename={(name) => renameEnvironment(bucket.connectionId, name)}
      onEnterFocus={() => focusEnvironment(bucket.environmentId)}
      upgradingLabel={upgradingLabel}
    />
  )
}

function RepoGroupHeader({
  name, open, locked = false, checkouts, environments,
  onToggle, onNewSession, onEdit, onRemove,
  onSwitchSession, onPinSession, onSettleSession, onRenameSession, onDeleteSession,
  openingSessionId, initialSessions, children,
}: {
  name: string
  open: boolean
  /** Every checkout's environment is offline, so the group has nothing to open. */
  locked?: boolean
  checkouts: HostCheckout[]
  environments: EnvironmentBucket[]
  onToggle: () => void
  onNewSession: () => void
  onEdit: (folder: RecentFolder) => void
  onRemove: (folder: RecentFolder) => void
  onSwitchSession: MultiHostProjectListProps['onSwitchSession']
  onPinSession: MultiHostProjectListProps['onPinSession']
  onSettleSession: MultiHostProjectListProps['onSettleSession']
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
        <div className={cn('group flex h-9 w-full items-center overflow-hidden rounded-md pl-2.5 pr-1.5 transition-colors', locked ? 'cursor-default opacity-60' : sidebarHoverCardRowClass)}>
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
        <SidebarHeightMorph morphKey={history}>
        {!locked && history ? (
          <ProjectHistoryList
            folderPath={target.pathKey}
            initialSessions={initialSessions}
            openingSessionId={openingSessionId}
            onClose={() => setHistory(false)}
            onSwitchSession={onSwitchSession}
            onPinSession={onPinSession}
            onSettleSession={onSettleSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        ) : (
          <SidebarCollapse open={open && !locked} unmountClosed>
            {children}
          </SidebarCollapse>
        )}
        </SidebarHeightMorph>
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
