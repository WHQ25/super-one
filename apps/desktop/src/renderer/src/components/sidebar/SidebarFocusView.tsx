import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { CalendarClock, Check, ChevronDown, Folder, FolderOpen, FolderX, List, Loader2, LogOut, MessageSquare, Monitor, Pin, Plus, Search, SquarePen, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { useSessionTitle } from '@/hooks/useSessionTitle'
import { checkoutToRecentFolder } from '@/lib/multi-host/checkout-folder'
import { presenterFor } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { ActiveSessionList } from './ActiveSessionList'
import { EnvironmentKindIcon, EnvironmentUpgradingIcon } from './multi-host/EnvironmentKindIcon'
import { EnvironmentRowActions } from './multi-host/EnvironmentSectionHeader'
import { MultiHostProjectList, type MultiHostProjectListProps } from './multi-host/MultiHostProjectList'
import { ProjectSidebarRow, type ProjectFocusActions } from './ProjectSidebarRow'
import { SessionRow } from './SessionRow'
import {
  applySidebarFocus,
  focusEnvironment,
  focusProject,
  focusSession,
  sidebarFocusCrumbs,
  useSidebarFocusStore,
  type SidebarFocus,
} from './sidebar-focus'

export interface SidebarFocusViewProps extends Pick<
  MultiHostProjectListProps,
  | 'environments'
  | 'sort'
  | 'expandedProjectKeys'
  | 'folderSessions'
  | 'sessionsHasMore'
  | 'onLoadMoreSessions'
  | 'childSessions'
  | 'childSessionsHasMore'
  | 'onLoadChildSessions'
  | 'onLoadMoreChildSessions'
  | 'settledSessions'
  | 'settledHasMore'
  | 'settledCounts'
  | 'onLoadMoreSettled'
  | 'loadingFolders'
  | 'openingSession'
  | 'onToggleProject'
  | 'onSwitchSession'
  | 'onPinSession'
  | 'onSettleSession'
  | 'onRenameSession'
  | 'onDeleteSession'
  | 'onEditProject'
  | 'onRemoveProject'
  | 'onNewSession'
  | 'onRefreshEnvironment'
  | 'onToggleConnection'
  | 'onAddProject'
  | 'onSort'
  | 'connectionBusyId'
  | 'refreshingConnectionId'
  | 'upgradingLabels'
> {
  folders: RecentFolder[]
  localHostLabel: string
  /** Loads a project that was still collapsed when it was focused. */
  onLoadFolderSessions: (folderPath: string) => void
  /** Pinned sessions and drafts for this environment or project. Sits under the focused object. */
  belowBar?: ReactNode
}

export interface FocusSwitchItem {
  id: string
  label: string
  current?: boolean
  onSelect: () => void
  /** Same glyph the object uses in the unfocused list. */
  icon?: ReactNode
}

/** Folder mark from a project row: open while it is the focused project, closed for a sibling. */
export function projectFocusIcon(state: { missing?: boolean; open?: boolean; loading?: boolean }): ReactNode {
  if (state.loading) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      </span>
    )
  }
  if (state.missing) return <FolderX className="size-4 shrink-0 text-destructive" aria-hidden />
  const Icon = state.open ? FolderOpen : Folder
  return <Icon className="size-4 shrink-0" aria-hidden />
}

/** Glyph for one row of the ancestor menu. Exit leaves focus; the others match the list. */
export function focusLevelIcon(level: {
  id: string
  environment?: Pick<EnvironmentBucket, 'kind' | 'connection' | 'path'> | null
  projectMissing?: boolean
  /** Sentence for the loading bars that replace this environment's glyph during a CLI install. */
  upgradingLabel?: string
}): ReactNode | undefined {
  if (level.id === 'root') return <LogOut className="size-4 shrink-0" aria-hidden />
  if (level.id === 'environment') {
    if (level.upgradingLabel) {
      return <EnvironmentUpgradingIcon label={level.upgradingLabel} className="size-4 shrink-0" />
    }
    if (!level.environment) return <Monitor className="size-4 shrink-0" aria-hidden />
    return (
      <EnvironmentKindIcon
        kind={level.environment.kind}
        connection={level.environment.connection}
        path={level.environment.path}
        className="size-4 shrink-0"
      />
    )
  }
  if (level.id === 'project') return projectFocusIcon({ missing: level.projectMissing, open: false })
  if (level.id === 'session') return <MessageSquare className="size-4 shrink-0" aria-hidden />
  return undefined
}

/** Title, ancestor levels, and the focused object's own actions. */
export function SidebarFocusBar({
  title,
  siblings,
  levels,
  actions,
  menuLabel,
  onAddProject,
}: {
  title: string
  siblings: FocusSwitchItem[]
  levels: FocusSwitchItem[]
  actions?: ReactNode
  /** Heading on the sibling menu. Project focus uses the chat project picker title. */
  menuLabel?: string
  /** Project focus reuses the chat picker, including its add-project row. */
  onAddProject?: () => void
}) {
  const { t } = useTranslation()
  const canSwitch = siblings.length > 1
  const currentIcon = siblings.find((item) => item.current)?.icon
  // Exit is an action, so it sits under the ancestor levels.
  const orderedLevels = [
    ...levels.filter((level) => level.id !== 'root'),
    ...levels.filter((level) => level.id === 'root'),
  ]
  return (
    <div data-sidebar-focus-bar className="flex h-9 shrink-0 items-center gap-1 px-1.5">
      <div className="group/levels relative shrink-0">
        <IconButton
          size="sm"
          variant="nested"
          aria-label={t('sidebar.focusLevels')}
          data-sidebar-focus-levels-trigger
        >
          <List />
        </IconButton>
        <div
          data-sidebar-focus-levels
          className="invisible absolute left-0 top-full z-30 pt-1 group-hover/levels:visible group-focus-within/levels:visible"
        >
          {/* brand-scope re-resolves popover tokens. Inside the sidebar the
              remapped accent would paint item hover as a dark slab on this light menu. */}
          <div className="brand-scope min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            {orderedLevels.map((level) => (
              <button
                key={level.id}
                type="button"
                data-focus-level={level.id}
                onClick={level.onSelect}
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                {level.icon}
                <span className="min-w-0 flex-1 truncate">{level.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {canSwitch ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-sidebar-focus-title
              className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md text-left text-muted-foreground outline-none transition-colors hover:text-foreground"
            >
              {currentIcon && (
                <span className="flex size-4 shrink-0 items-center justify-center">{currentIcon}</span>
              )}
              <span className="flex min-w-0 max-w-full items-center gap-1">
                <span className="truncate text-sm font-medium">{title}</span>
                <ChevronDown className="size-3 shrink-0" aria-hidden />
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-64 overflow-hidden"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {menuLabel && (
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{menuLabel}</DropdownMenuLabel>
            )}
            <ScrollArea
              type="scroll"
              edgeFade
              className="max-h-48 min-h-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:block!"
            >
              {siblings.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="justify-between focus-visible:shadow-none"
                  onClick={() => {
                    if (!item.current) item.onSelect()
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.current && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </DropdownMenuItem>
              ))}
            </ScrollArea>
            {onAddProject && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onAddProject} className="gap-2 focus-visible:shadow-none">
                  <Plus className="size-4 shrink-0" />
                  <span>{t('chat.suggestions.addProject')}</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span data-sidebar-focus-title className="flex min-w-0 flex-1 items-center gap-2">
          {currentIcon && (
            <span className="flex size-4 shrink-0 items-center justify-center text-sidebar-foreground/70">{currentIcon}</span>
          )}
          <span className="truncate text-sm font-medium">{title}</span>
        </span>
      )}
      <div data-sidebar-focus-actions className="ml-auto flex shrink-0 items-center gap-0.5">
        {actions}
      </div>
    </div>
  )
}

function resolveFolder(folderPath: string, folders: RecentFolder[], environments: EnvironmentBucket[]): RecentFolder {
  const listed = folders.find((folder) => folder.path === folderPath)
  if (listed) return listed
  for (const bucket of environments) {
    const checkout = bucket.checkouts.find((item) => item.pathKey === folderPath)
    if (checkout) return checkoutToRecentFolder(checkout)
  }
  const name = folderPath.split(/[/\\]/).filter(Boolean).pop() ?? folderPath
  return { id: folderPath, name, path: folderPath, addedAt: '', lastOpened: '' }
}

function listedSession(
  folderSessions: Record<string, SessionHistoryEntry[]>,
  childSessions: SidebarFocusViewProps['childSessions'],
  folderPath: string,
  sessionId: string,
): SessionHistoryEntry | undefined {
  const root = folderSessions[folderPath]?.find((session) => session.sessionId === sessionId)
  if (root) return root
  const families = childSessions?.[folderPath]
  if (!families) return undefined
  for (const children of Object.values(families)) {
    const match = children.find((session) => session.sessionId === sessionId)
    if (match) return match
  }
  return undefined
}

function focusSiblingItems(args: {
  target: SidebarFocus
  environments: EnvironmentBucket[]
  folders: RecentFolder[]
  folderSessions: Record<string, SessionHistoryEntry[]>
  childSessions: SidebarFocusViewProps['childSessions']
  sessionTitle: string
  currentProjectName?: string
  currentProjectMissing?: boolean
  loadingFolders: Record<string, boolean>
  upgradingLabels?: Readonly<Record<string, string>>
}): FocusSwitchItem[] {
  const { target } = args
  if (target.kind === 'environment') {
    return args.environments.map((bucket) => ({
      id: bucket.environmentId,
      label: bucket.label,
      current: bucket.environmentId === target.environmentId,
      icon: focusLevelIcon({
        id: 'environment',
        environment: bucket,
        upgradingLabel: args.upgradingLabels?.[bucket.connectionId],
      }),
      onSelect: () => focusEnvironment(bucket.environmentId),
    }))
  }
  if (target.kind === 'project') {
    const bucket = target.environmentId
      ? args.environments.find((item) => item.environmentId === target.environmentId)
      : undefined
    const projects = target.environmentId
      ? (bucket?.checkouts ?? [])
          .filter((checkout) => !checkout.missing || checkout.pathKey === target.folderPath)
          .map((checkout) => ({ id: checkout.pathKey, label: checkout.name, path: checkout.pathKey, missing: checkout.missing === true }))
      : args.folders
          .filter((folder) => !folder.missing || folder.path === target.folderPath)
          .map((folder) => ({ id: folder.path, label: folder.name, path: folder.path, missing: folder.missing === true }))
    if (!projects.some((project) => project.path === target.folderPath) && args.currentProjectName) {
      projects.unshift({
        id: target.folderPath,
        label: args.currentProjectName,
        path: target.folderPath,
        missing: args.currentProjectMissing === true,
      })
    }
    return projects.map((project) => {
      const current = project.path === target.folderPath
      return {
        id: project.id,
        label: project.label,
        current,
        icon: projectFocusIcon({
          missing: project.missing,
          open: current,
          loading: current && args.loadingFolders[project.path] === true,
        }),
        onSelect: () => focusProject(project.path, target.environmentId),
      }
    })
  }
  const roots = args.folderSessions[target.folderPath] ?? []
  const families = args.childSessions?.[target.folderPath]
  const parents = roots.filter((session) => (
    (session.childCount ?? 0) > 0
    || (families?.[session.sessionId]?.length ?? 0) > 0
    || session.sessionId === target.sessionId
  ))
  return parents.map((session) => ({
    id: session.sessionId,
    label: session.sessionId === target.sessionId ? args.sessionTitle : session.title,
    current: session.sessionId === target.sessionId,
    onSelect: () => focusSession(target.folderPath, session.sessionId, target.environmentId),
  }))
}

function FocusResidentActions({
  target,
  bucket,
  sessionEntry,
  projectActionsRef,
  props,
}: {
  target: SidebarFocus
  bucket: EnvironmentBucket | undefined
  sessionEntry: SessionHistoryEntry | undefined
  projectActionsRef: RefObject<ProjectFocusActions | null>
  props: SidebarFocusViewProps
}) {
  const { t } = useTranslation()
  if (target.kind === 'project') {
    return (
      <>
        <IconButton size="sm" variant="nested" tooltip={t('sidebar.contextMenu.searchSessions')} tooltipSideOffset={8} onClick={() => projectActionsRef.current?.openHistory()}>
          <Search />
        </IconButton>
        <IconButton size="sm" variant="nested" tooltip={t('tooltips.newAutomation')} tooltipSideOffset={8} onClick={() => projectActionsRef.current?.openAutomation()}>
          <CalendarClock />
        </IconButton>
        <IconButton size="sm" variant="nested" tooltip={t('tooltips.newSession')} tooltipSideOffset={8} onClick={() => props.onNewSession(target.folderPath)}>
          <SquarePen />
        </IconButton>
      </>
    )
  }
  if (target.kind === 'environment') {
    if (!bucket) return null
    const remote = bucket.kind !== 'local'
    return (
      <EnvironmentRowActions
        resident
        offline={bucket.connection === 'offline'}
        remote={remote}
        connection={bucket.connection}
        refreshing={props.refreshingConnectionId === bucket.connectionId}
        connectionBusy={props.connectionBusyId === bucket.connectionId}
        sort={props.sort}
        onSort={props.onSort}
        onAddProject={() => props.onAddProject(bucket.connectionId)}
        onRefresh={remote ? () => props.onRefreshEnvironment(bucket.connectionId) : undefined}
        onToggleConnection={remote ? () => props.onToggleConnection(bucket.connectionId, bucket.connection) : undefined}
        upgrading={Boolean(props.upgradingLabels?.[bucket.connectionId])}
      />
    )
  }
  if (!sessionEntry) return null
  if (sessionEntry.isSettled) {
    return (
      <IconButton
        size="sm"
        variant="nested"
        tooltip={t('sidebar.contextMenu.unsettle')}
        onClick={() => props.onSettleSession(sessionEntry.sessionId, false, target.folderPath)}
      >
        <Undo2 />
      </IconButton>
    )
  }
  return (
    <IconButton
      size="sm"
      variant="nested"
      tooltip={sessionEntry.isPinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin')}
      onClick={() => props.onPinSession(sessionEntry.sessionId, !sessionEntry.isPinned, target.folderPath)}
    >
      <Pin />
    </IconButton>
  )
}

function presenterForFolder(environments: EnvironmentBucket[], folder: RecentFolder, localHostLabel: string) {
  const bucket = environments.find((item) => item.checkouts.some((checkout) => checkout.pathKey === folder.path))
  if (bucket) return presenterFor(bucket, folder.name, folder.path)
  return presenterFor(
    { label: localHostLabel, kind: 'local', connection: 'connected' },
    folder.name,
    folder.path,
  )
}

function SessionFocusList({
  folderPath,
  sessionId,
  props,
}: {
  folderPath: string
  sessionId: string
  props: SidebarFocusViewProps
}) {
  const { t } = useTranslation()
  const children = props.childSessions?.[folderPath]?.[sessionId]
  const folder = resolveFolder(folderPath, props.folders, props.environments)
  const present = presenterForFolder(props.environments, folder, props.localHostLabel)
  if (!children) {
    return <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>
  }
  if (children.length === 0) {
    return <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>
  }
  return (
    <ActiveSessionList
      kind="child"
      layout="fill"
      hasMore={props.childSessionsHasMore?.[folderPath]?.[sessionId] === true}
      onLoadMore={() => props.onLoadMoreChildSessions?.(folderPath, sessionId)}
    >
      {children.map((child) => {
        const presentation = present(child)
        return (
          <SessionRow
            key={child.sessionId}
            session={child}
            folderPath={folderPath}
            childSession
            opening={props.openingSession?.folderPath === folderPath && props.openingSession.sessionId === child.sessionId}
            onSwitchSession={props.onSwitchSession}
            onPinSession={props.onPinSession}
            onSettleSession={props.onSettleSession}
            onRenameSession={props.onRenameSession}
            onDeleteSession={props.onDeleteSession}
            hover={presentation.hover}
            environmentOffline={presentation.environmentOffline}
          />
        )
      })}
    </ActiveSessionList>
  )
}

/**
 * The list under the app drawer, given over to one environment, project, or
 * parent session. The bar switches siblings and steps up to an ancestor.
 */
export function SidebarFocusView(props: SidebarFocusViewProps) {
  const { t } = useTranslation()
  const target = useSidebarFocusStore((state) => state.target)
  const loadFolderRef = useRef(props.onLoadFolderSessions)
  const loadChildRef = useRef(props.onLoadChildSessions)
  const projectActionsRef = useRef<ProjectFocusActions | null>(null)
  loadFolderRef.current = props.onLoadFolderSessions
  loadChildRef.current = props.onLoadChildSessions
  const { folderSessions, childSessions, folders, environments, localHostLabel } = props

  useEffect(() => {
    if (!target || target.kind === 'environment') return
    if (!folderSessions[target.folderPath]) loadFolderRef.current(target.folderPath)
    if (target.kind === 'session') void loadChildRef.current?.(target.folderPath, target.sessionId)
  }, [target, folderSessions])

  const folder = target && target.kind !== 'environment'
    ? resolveFolder(target.folderPath, folders, environments)
    : null
  const sessionEntry = target?.kind === 'session'
    ? listedSession(folderSessions, childSessions, target.folderPath, target.sessionId)
    : undefined
  const sessionTitle = useSessionTitle(
    target?.kind === 'session' ? target.folderPath : null,
    target?.kind === 'session' ? target.sessionId : null,
    sessionEntry?.title,
  )
  if (!target) return null

  const bucket = target.environmentId
    ? environments.find((item) => item.environmentId === target.environmentId)
    : undefined
  const crumbs = sidebarFocusCrumbs(target, {
    root: t('sidebar.focusExit'),
    environment: bucket?.label,
    project: folder?.name,
    session: sessionTitle,
  })
  const title = crumbs.find((crumb) => crumb.current)?.label ?? ''
  const levels: FocusSwitchItem[] = crumbs
    .filter((crumb) => !crumb.current)
    .map((crumb) => ({
      id: crumb.id,
      label: crumb.label,
      icon: focusLevelIcon({
        id: crumb.id,
        environment: bucket,
        projectMissing: folder?.missing,
        upgradingLabel: crumb.id === 'environment' ? props.upgradingLabels?.[bucket?.connectionId ?? ''] : undefined,
      }),
      onSelect: () => applySidebarFocus(crumb.target),
    }))
  const siblings = focusSiblingItems({
    target,
    environments,
    folders,
    folderSessions,
    childSessions,
    sessionTitle,
    currentProjectName: folder?.name,
    currentProjectMissing: folder?.missing,
    loadingFolders: props.loadingFolders,
    upgradingLabels: props.upgradingLabels,
  })

  let body: ReactNode
  if (target.kind === 'environment') {
    body = (
      <ScrollArea type="scroll" edgeFade className="sidebar-scroll h-full min-h-0 flex-1">
        {bucket ? (
          <MultiHostProjectList
            environments={[bucket]}
            groupBy="environment"
            sort={props.sort}
            expandedProjectKeys={props.expandedProjectKeys}
            collapsedEnvironmentIds={[]}
            folderSessions={props.folderSessions}
            sessionsHasMore={props.sessionsHasMore}
            onLoadMoreSessions={props.onLoadMoreSessions}
            childSessions={props.childSessions}
            childSessionsHasMore={props.childSessionsHasMore}
            onLoadChildSessions={props.onLoadChildSessions}
            onLoadMoreChildSessions={props.onLoadMoreChildSessions}
            settledSessions={props.settledSessions}
            settledHasMore={props.settledHasMore}
            settledCounts={props.settledCounts}
            onLoadMoreSettled={props.onLoadMoreSettled}
            loadingFolders={props.loadingFolders}
            openingSession={props.openingSession}
            onToggleProject={props.onToggleProject}
            onToggleEnvironment={() => {}}
            onSwitchSession={props.onSwitchSession}
            onPinSession={props.onPinSession}
            onSettleSession={props.onSettleSession}
            onRenameSession={props.onRenameSession}
            onDeleteSession={props.onDeleteSession}
            onEditProject={props.onEditProject}
            onRemoveProject={props.onRemoveProject}
            onNewSession={props.onNewSession}
            onRefreshEnvironment={props.onRefreshEnvironment}
            onToggleConnection={props.onToggleConnection}
            onAddProject={props.onAddProject}
            onSort={props.onSort}
            connectionBusyId={props.connectionBusyId}
            refreshingConnectionId={props.refreshingConnectionId}
            flat
          />
        ) : (
          <div className="px-3 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.environmentSection.empty')}</div>
        )}
      </ScrollArea>
    )
  } else if (target.kind === 'project' && folder) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <ProjectSidebarRow
          folder={folder}
          sessionsOnly
          isExpanded
          sessionListLayout="fill"
          focusEnvironmentId={target.environmentId}
          focusActionsRef={projectActionsRef}
          sessions={props.folderSessions[folder.path] ?? []}
          sessionsHasMore={props.sessionsHasMore?.[folder.path] ?? false}
          onLoadMoreSessions={props.onLoadMoreSessions}
          childSessions={props.childSessions?.[folder.path]}
          childSessionsHasMore={props.childSessionsHasMore?.[folder.path]}
          onLoadChildSessions={props.onLoadChildSessions}
          onLoadMoreChildSessions={props.onLoadMoreChildSessions}
          settledSessions={props.settledSessions}
          settledHasMore={props.settledHasMore?.[folder.path] ?? false}
          settledCount={props.settledCounts?.[folder.path]}
          onLoadMoreSettled={props.onLoadMoreSettled}
          sessionsLoading={props.loadingFolders[folder.path] === true}
          openingSessionId={props.openingSession?.folderPath === folder.path ? props.openingSession.sessionId : null}
          onToggleExpand={props.onToggleProject}
          onSwitchSession={props.onSwitchSession}
          onPinSession={props.onPinSession}
          onSettleSession={props.onSettleSession}
          onEditProject={props.onEditProject}
          onRemoveProject={props.onRemoveProject}
          onRenameSession={props.onRenameSession}
          onDeleteSession={props.onDeleteSession}
          onNewSession={props.onNewSession}
          offline={bucket?.connection === 'offline'}
          sessionPresentation={presenterForFolder(props.environments, folder, props.localHostLabel)}
        />
      </div>
    )
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <SessionFocusList folderPath={target.kind === 'session' ? target.folderPath : ''} sessionId={target.kind === 'session' ? target.sessionId : ''} props={props} />
      </div>
    )
  }

  return (
    <div data-sidebar-focus className="flex min-h-0 flex-1 flex-col">
      <SidebarFocusBar
        title={title}
        siblings={siblings}
        levels={levels}
        menuLabel={target.kind === 'project'
          ? t('chat.suggestions.selectProject')
          : target.kind === 'environment'
            ? t('sidebar.focusSwitchEnvironment')
            : t('sidebar.focusSwitchSession')}
        onAddProject={target.kind === 'project' ? () => {
          const connectionId = bucket?.connectionId
            ?? environments.find((item) => item.kind === 'local')?.connectionId
          if (connectionId) props.onAddProject(connectionId)
        } : undefined}
        actions={(
          <FocusResidentActions
            target={target}
            bucket={bucket}
            sessionEntry={sessionEntry}
            projectActionsRef={projectActionsRef}
            props={props}
          />
        )}
      />
      {props.belowBar && (
        <div data-sidebar-focus-context className="shrink-0">
          {props.belowBar}
        </div>
      )}
      <div key={crumbKey(target)} className="flex min-h-0 flex-1 flex-col">
        {body}
      </div>
    </div>
  )
}

function crumbKey(target: SidebarFocus): string {
  if (target.kind === 'environment') return `environment:${target.environmentId}`
  if (target.kind === 'project') return `project:${target.environmentId ?? ''}:${target.folderPath}`
  return `session:${target.environmentId ?? ''}:${target.folderPath}:${target.sessionId}`
}
