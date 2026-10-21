import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, Pencil, Trash2 } from 'lucide-react'
import type { RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { checkoutToRecentFolder } from '@/lib/multi-host/checkout-folder'
import { environmentSections, groupCheckoutsByRepo, sortProjectGroups } from '@/lib/multi-host/group-projects'
import { buildSessionHover } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket, HostCheckout, SidebarGroupBy, SidebarSort } from '@/lib/multi-host/types'
import { DraftsSection } from '@/components/sidebar/DraftsSection'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'
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
  draftConnectionIds: string[]
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
  connectionBusyId: string | null
  refreshingConnectionId: string | null
}

function presentationFor(checkout: HostCheckout, bucket: EnvironmentBucket) {
  return (session: SessionHistoryEntry, sessions: SessionHistoryEntry[]) => {
    const parent = session.parentSessionId
      ? sessions.find((row) => row.sessionId === session.parentSessionId)
      : undefined
    return {
      hover: buildSessionHover({
        session,
        checkout,
        bucket,
        parentTitle: parent?.title ?? null,
        childCount: sessions.filter((row) => row.parentSessionId === session.sessionId).length,
      }),
      environmentOffline: bucket.connection === 'offline',
    }
  }
}

export function MultiHostProjectList(props: MultiHostProjectListProps) {
  const { t } = useTranslation()
  const {
    environments, groupBy, sort, expandedProjectKeys, collapsedEnvironmentIds,
    draftConnectionIds,
  } = props

  const checkoutRow = (checkout: HostCheckout, bucket: EnvironmentBucket, name?: string) => {
    const folder = checkoutToRecentFolder(checkout, name)
    return (
      <ProjectSidebarRow
        key={checkout.pathKey}
        folder={folder}
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
        sessionPresentation={presentationFor(checkout, bucket)}
      />
    )
  }

  const drafts = draftConnectionIds.map((connectionId) => (
    <DraftsSection key={connectionId} connectionId={connectionId} />
  ))

  if (groupBy === 'environment') {
    const sections = environmentSections(environments, sort)
    return (
      <div className="flex w-0 min-w-full flex-col px-1.5 pb-1.5">
        {drafts}
        {sections.map(({ bucket, checkouts }) => {
          const expanded = !collapsedEnvironmentIds.includes(bucket.environmentId)
          return (
            <div key={bucket.environmentId}>
              <EnvironmentHeader
                bucket={bucket}
                expanded={expanded}
                refreshing={props.refreshingConnectionId === bucket.connectionId}
                connectionBusy={props.connectionBusyId === bucket.connectionId}
                onToggle={() => props.onToggleEnvironment(bucket.environmentId)}
                onRefresh={() => props.onRefreshEnvironment(bucket.connectionId)}
                onToggleConnection={() => props.onToggleConnection(bucket.connectionId, bucket.connection)}
                onAddProject={() => props.onAddProject(bucket.connectionId)}
              />
              {expanded && bucket.connection === 'offline' && checkouts.length === 0 && (
                <div className="flex flex-col items-center gap-1 px-4 py-3 text-center text-xs text-sidebar-foreground/70">
                  <span>{t('sidebar.hostDisconnected')}</span>
                  <span>{t('sidebar.hostConnectHint')}</span>
                </div>
              )}
              {expanded && bucket.projectsStatus === 'loading' && checkouts.length === 0 && (
                <div className="px-6 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>
              )}
              {expanded && bucket.projectsStatus === 'ready' && checkouts.length === 0 && bucket.connection !== 'offline' && (
                <div className="px-6 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.environmentSection.empty')}</div>
              )}
              {expanded && checkouts.map((checkout) => checkoutRow(checkout, bucket))}
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
    <div className="flex w-0 min-w-full flex-col px-1.5 pb-1.5">
      {drafts}
      {errors.map((bucket) => (
        <button
          key={bucket.environmentId}
          type="button"
          className="px-2 py-1 text-left text-[11px] text-sidebar-foreground/70"
          onClick={() => props.onRefreshEnvironment(bucket.connectionId)}
        >
          {bucket.label}: {bucket.projectsError || t('common.retry')}
        </button>
      ))}
      {groups.map((group) => {
        if (group.checkouts.length === 1) {
          const checkout = group.checkouts[0]!
          const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
          if (!bucket) return null
          return checkoutRow(checkout, bucket)
        }
        const groupKey = `group:${group.key}`
        const open = expandedProjectKeys.has(groupKey)
        return (
          <div key={group.key}>
            <RepoGroupHeader
              name={group.name}
              open={open}
              checkouts={group.checkouts}
              environments={environments}
              onToggle={() => props.onToggleProject(groupKey)}
              onEdit={props.onEditProject}
              onRemove={props.onRemoveProject}
            />
            {open && group.checkouts.map((checkout) => {
              const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
              if (!bucket) return null
              return checkoutRow(checkout, bucket, bucket.label)
            })}
          </div>
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
  bucket, expanded, refreshing, connectionBusy, onToggle, onRefresh, onToggleConnection, onAddProject,
}: {
  bucket: EnvironmentBucket
  expanded: boolean
  refreshing: boolean
  connectionBusy: boolean
  onToggle: () => void
  onRefresh: () => void
  onToggleConnection: () => void
  onAddProject: () => void
}) {
  return (
    <EnvironmentSectionHeader
      label={bucket.label}
      kind={bucket.kind}
      connection={bucket.connection}
      expanded={expanded}
      projectsStatus={bucket.projectsStatus}
      projectsError={bucket.projectsError}
      refreshing={refreshing}
      connectionBusy={connectionBusy}
      onToggle={onToggle}
      onRefresh={bucket.kind === 'local' ? undefined : onRefresh}
      onToggleConnection={bucket.kind === 'local' ? undefined : onToggleConnection}
      onAddProject={onAddProject}
    />
  )
}

function RepoGroupHeader({
  name, open, checkouts, environments, onToggle, onEdit, onRemove,
}: {
  name: string
  open: boolean
  checkouts: HostCheckout[]
  environments: EnvironmentBucket[]
  onToggle: () => void
  onEdit: (folder: RecentFolder) => void
  onRemove: (folder: RecentFolder) => void
}) {
  const { t } = useTranslation()
  const targetLabel = (checkout: HostCheckout) => {
    const bucket = environments.find((item) => item.environmentId === checkout.environmentId)
    return t('sidebar.actionTarget', { environment: bucket?.label ?? checkout.connectionId, path: checkout.hostPath })
  }
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
  return (
    <AdaptiveContextMenu items={items} contentClassName="w-56">
      <button
        type="button"
        onClick={onToggle}
        className="group flex h-9 w-full items-center gap-1 overflow-hidden rounded-md px-2.5 text-left hover:bg-sidebar-hover"
      >
        <ChevronRight className={cn('size-4 shrink-0 text-sidebar-foreground/70 transition-transform', open && 'rotate-90')} />
        <Folder className="size-4 shrink-0 text-sidebar-foreground/70" />
        <span className="min-w-0 truncate text-md">{name}</span>
      </button>
    </AdaptiveContextMenu>
  )
}
