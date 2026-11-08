import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Search, SquarePen } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { checkoutToRecentFolder } from '@/lib/multi-host/checkout-folder'
import { sortCheckouts } from '@/lib/multi-host/group-projects'
import { presenterFor } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { EnvironmentKindIcon, EnvironmentUpgradingIcon } from './multi-host/EnvironmentKindIcon'
import { ProjectSidebarRow, type ProjectFocusActions } from './ProjectSidebarRow'
import { SettledSessionList } from './SettledSection'
import { AutomationDialog } from '@/components/AutomationDialog'
import { ProjectHistoryList, ProjectHistorySearch } from './ProjectHistoryList'
import { SidebarCollapse } from './SidebarCollapse'
import { SidebarSectionLabel } from './SidebarSectionLabel'
import { projectFocusSessionListMaxHeights, type ProjectFocusListMax } from './session-list-scroll'
import type { SidebarFocusViewProps } from './SidebarFocusView'
import { cn } from '@superone/ui/lib/utils'

/** Compact section styling for focus, distinct from the full environment rows. */
export function FocusEnvironmentGroup({
  bucket, count = 0, initiallyExpanded = false, upgradingLabel, unmountCollapsed = false, revealKey = 0, fill = false, onSearch, onNewAutomation, onNewSession, children,
}: {
  bucket: EnvironmentBucket
  count?: number
  initiallyExpanded?: boolean
  upgradingLabel?: string
  unmountCollapsed?: boolean
  revealKey?: number
  /** The only online list: this group takes the pane so its sessions can fill it. */
  fill?: boolean
  onSearch?: () => void
  onNewAutomation?: () => void
  onNewSession?: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const panelId = useId()
  useEffect(() => {
    if (revealKey > 0) setExpanded(true)
  }, [revealKey])
  return (
    <div data-focus-environment={bucket.environmentId} className={cn(fill && 'flex min-h-0 flex-1 flex-col')}>
      <SidebarSectionLabel
        section="environment"
        count={count}
        countTone="plain"
        collapsed={!expanded}
        onToggle={() => setExpanded((value) => !value)}
        controlsId={panelId}
        chevronWhenExpanded
        actions={(onSearch || onNewAutomation || onNewSession) && bucket.connection === 'connected' && !upgradingLabel ? (
          <>
          {onSearch && <IconButton size="xs" variant="nested" tooltip={t('sidebar.contextMenu.searchSessions')} tooltipSideOffset={8} onClick={onSearch}><Search /></IconButton>}
          {onNewAutomation && <IconButton size="xs" variant="nested" tooltip={t('tooltips.newAutomation')} tooltipSideOffset={8} onClick={onNewAutomation}><CalendarClock /></IconButton>}
          {onNewSession && (
          <IconButton size="xs" variant="nested" tooltip={t('tooltips.newSession')} tooltipSideOffset={8} onClick={onNewSession}>
            <SquarePen />
          </IconButton>
          )}
          </>
        ) : undefined}
        icon={upgradingLabel
          ? <EnvironmentUpgradingIcon label={upgradingLabel} className="size-3" />
          : <EnvironmentKindIcon {...bucket} className="size-3 text-sidebar-foreground/45" />}
      >
        {bucket.label}
      </SidebarSectionLabel>
      <SidebarCollapse
        id={panelId}
        open={expanded}
        fill={fill}
        unmountClosed={unmountCollapsed}
        innerClassName="pl-1"
      >
        {children}
      </SidebarCollapse>
    </div>
  )
}

/** One environment's checkouts in project focus. The environment heading is optional. */
function ActiveFocusSessions({
  bucket, checkouts, props, listMax,
}: {
  bucket: EnvironmentBucket
  checkouts: EnvironmentBucket['checkouts']
  props: SidebarFocusViewProps
  listMax: (pathKey: string) => ProjectFocusListMax
}) {
  const { t } = useTranslation()
  if (bucket.connection === 'offline') {
    return (
      <button
        type="button"
        className="px-2.5 py-2 text-left text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
        disabled={props.connectionBusyId === bucket.connectionId}
        onClick={() => props.onToggleConnection(bucket.connectionId, bucket.connection)}
      >
        {t('sidebar.sessionOffline')}
      </button>
    )
  }
  return (
    <>
      {checkouts.some((checkout) => !props.folderSessions[checkout.pathKey] || props.loadingFolders[checkout.pathKey]) && (
        <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>
      )}
      {checkouts.every((checkout) => props.folderSessions[checkout.pathKey]?.length === 0 && !props.loadingFolders[checkout.pathKey]) && (
        <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>
      )}
      {checkouts.map((checkout) => {
        const max = listMax(checkout.pathKey)
        return (
        <ProjectSidebarRow
          key={checkout.pathKey}
          folder={checkoutToRecentFolder(checkout)}
          repoIdentity={checkout.repoIdentity}
          sessionsOnly
          isExpanded
          showSettled={false}
          sessionListLayout={max.kind === 'fill' ? 'fill' : 'cap'}
          sessionListMaxHeight={max.kind === 'px' ? max.maxHeight : undefined}
          focusEnvironmentId={bucket.environmentId}
          sessions={props.folderSessions[checkout.pathKey] ?? []}
          sessionsHasMore={props.sessionsHasMore?.[checkout.pathKey]}
          onLoadMoreSessions={props.onLoadMoreSessions}
          childSessions={props.childSessions?.[checkout.pathKey]}
          childSessionsHasMore={props.childSessionsHasMore?.[checkout.pathKey]}
          onLoadChildSessions={props.onLoadChildSessions}
          onLoadMoreChildSessions={props.onLoadMoreChildSessions}
          settledSessions={props.settledSessions}
          sessionsLoading={props.loadingFolders[checkout.pathKey]}
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
          sessionPresentation={presenterFor(bucket, checkout.name, checkout.pathKey)}
        />
        )
      })}
    </>
  )
}

function SettledFocusSessions({
  bucket, checkouts, sessions, paths, props,
}: {
  bucket: EnvironmentBucket
  checkouts: EnvironmentBucket['checkouts']
  sessions: NonNullable<SidebarFocusViewProps['settledSessions']>
  paths: readonly string[]
  props: SidebarFocusViewProps
}) {
  return (
    <SettledSessionList
      sessions={sessions}
      hasMore={bucket.connection !== 'offline' && checkouts.some((checkout) => props.settledHasMore?.[checkout.pathKey])}
      onLoadMore={() => Promise.all(checkouts
        .filter((checkout) => props.settledHasMore?.[checkout.pathKey])
        .map((checkout) => props.onLoadMoreSettled?.(checkout.pathKey))).then(() => {})}
      openingSessionId={props.openingSession && paths.includes(props.openingSession.folderPath) ? props.openingSession.sessionId : null}
      presentation={(session) => presenterFor(bucket, session.folderName, session.folderPath)(session)}
      onSwitchSession={(folderPath, sessionId) => props.onSwitchSession(folderPath, sessionId, { revealProject: false })}
      onPinSession={props.onPinSession}
      onSettleSession={props.onSettleSession}
      onRenameSession={props.onRenameSession}
      onDeleteSession={props.onDeleteSession}
    />
  )
}

/** All checkouts of the focused origin. Environment headings appear only when more than one environment has rows. */
export function ProjectFocusList({
  paths, focusedPath, actionsRef, props,
}: {
  paths: readonly string[]
  focusedPath: string
  actionsRef: RefObject<ProjectFocusActions | null>
  props: SidebarFocusViewProps
}) {
  const { t } = useTranslation()
  const [settledExpanded, setSettledExpanded] = useState(false)
  const settledPanelId = useId()
  const [search, setSearch] = useState<{ environmentId: string | null; revealKey: number; query: string } | null>(null)
  const [automationTarget, setAutomationTarget] = useState<{ path: string; environmentId?: string } | null>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const [paneHeight, setPaneHeight] = useState(0)
  useLayoutEffect(() => {
    const node = paneRef.current
    if (!node) return
    const read = () => {
      const next = node.clientHeight
      setPaneHeight((current) => (current === next ? current : next))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useImperativeHandle(actionsRef, () => ({
    openHistory: () => setSearch((prev) => ({ environmentId: null, revealKey: (prev?.revealKey ?? 0) + 1, query: prev?.query ?? '' })),
    openAutomation: () => setAutomationTarget({ path: focusedPath }),
  }), [focusedPath])
  const sections = props.environments.flatMap((bucket) => {
    const checkouts = sortCheckouts(bucket.checkouts.filter((checkout) => paths.includes(checkout.pathKey)), props.sort)
    return checkouts.length ? [{ bucket, checkouts }] : []
  })
  const settledSections = sections.map((section) => {
    const sectionPaths = new Set(section.checkouts.map((checkout) => checkout.pathKey))
    const sessions = (props.settledSessions ?? []).filter((session) => sectionPaths.has(session.folderPath))
    const count = section.checkouts.reduce((total, checkout) => total + (
      props.settledCounts?.[checkout.pathKey] ?? sessions.filter((session) => session.folderPath === checkout.pathKey).length
    ), 0)
    return { ...section, sessions, count }
  }).filter((section) => section.count > 0)
  const settledCount = settledSections.reduce((total, section) => total + section.count, 0)
  const groupActive = sections.length > 1
  const groupSettled = settledSections.length > 1

  const listSizes = sections.flatMap(({ bucket, checkouts }) => (
    bucket.connection === 'offline'
      ? []
      : checkouts.map((checkout) => ({
          key: checkout.pathKey,
          environmentId: bucket.environmentId,
          sessionCount: props.folderSessions[checkout.pathKey]?.length ?? 0,
          hasMore: props.sessionsHasMore?.[checkout.pathKey] === true,
        }))
  ))
  const listMaxes = projectFocusSessionListMaxHeights(listSizes, paneHeight)
  const maxByPath = new Map(listSizes.map((list, index) => [list.key, listMaxes[index]!]))
  const listMax = (pathKey: string): ProjectFocusListMax => maxByPath.get(pathKey) ?? { kind: 'cap' }
  // One online list is the pane. Several lists share it, and the outer scroller
  // only appears once a cap is back in play. Search keeps that scroller so history
  // does not stretch to the pane.
  const fillsPane = !search && listMaxes.every((max) => max.kind === 'fill')

  const historyProjectIds = useMemo(() => Object.fromEntries(props.environments.flatMap((bucket) => bucket.checkouts.map((checkout) => [checkout.pathKey, checkout.projectId]))), [props.environments])
  const history = (folderPaths: string[]) => (
    <ProjectHistoryList
      folderPath={folderPaths[0] ?? focusedPath}
      folderPaths={folderPaths}
      projectIds={historyProjectIds}
      searchQuery={search?.query ?? ''}
      onSearchQueryChange={(query) => setSearch((prev) => prev ? { ...prev, query } : prev)}
      showSearch={search?.environmentId !== null}
      openingSessionId={props.openingSession?.sessionId}
      openingFolderPath={props.openingSession?.folderPath}
      onClose={() => setSearch(null)}
      onSwitchSession={(path, sessionId) => props.onSwitchSession(path, sessionId, { revealProject: false })}
      onPinSession={props.onPinSession} onSettleSession={props.onSettleSession}
      onRenameSession={props.onRenameSession} onDeleteSession={props.onDeleteSession}
      presentation={(path, session) => {
        const bucket = sections.find((section) => section.checkouts.some((checkout) => checkout.pathKey === path))?.bucket
        const checkout = bucket?.checkouts.find((entry) => entry.pathKey === path)
        return bucket && checkout ? presenterFor(bucket, checkout.name, path)(session) : {}
      }}
    />
  )

  const activeSections = sections.map(({ bucket, checkouts }) => {
    const target = checkouts.find((checkout) => checkout.pathKey === focusedPath && !checkout.missing)
      ?? checkouts.find((checkout) => !checkout.missing)
    const searching = search && (search.environmentId === null || search.environmentId === bucket.environmentId)
    const body = searching ? history(checkouts.map((checkout) => checkout.pathKey)) : (
      <ActiveFocusSessions
        bucket={bucket}
        checkouts={checkouts}
        props={props}
        listMax={listMax}
      />
    )
    const fillSection = fillsPane && bucket.connection !== 'offline'
    return groupActive ? (
      <FocusEnvironmentGroup
        key={bucket.environmentId}
        bucket={bucket}
        initiallyExpanded
        fill={fillSection}
        revealKey={search && (search.environmentId === null || search.environmentId === bucket.environmentId) ? search.revealKey : 0}
        upgradingLabel={props.upgradingLabels?.[bucket.connectionId]}
        onSearch={() => setSearch((prev) => ({ environmentId: bucket.environmentId, revealKey: (prev?.revealKey ?? 0) + 1, query: prev?.query ?? '' }))}
        onNewAutomation={target ? () => setAutomationTarget({ path: target.pathKey, environmentId: bucket.environmentId }) : undefined}
        onNewSession={target ? () => props.onNewSession(target.pathKey) : undefined}
      >
        {body}
      </FocusEnvironmentGroup>
    ) : <div key={bucket.environmentId} className={cn(fillSection && 'flex min-h-0 w-full min-w-0 flex-1 flex-col')}>{body}</div>
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-0.5">
      {search?.environmentId === null && (
        <div data-project-focus-search="all" className="shrink-0">
          <ProjectHistorySearch
            query={search.query}
            onQueryChange={(query) => setSearch((prev) => prev ? { ...prev, query } : prev)}
            onClose={() => setSearch(null)}
            label={t('sidebar.search.allEnvironments')}
          />
        </div>
      )}
      <div ref={paneRef} data-project-focus-active className="flex min-h-0 flex-1 flex-col">
        {fillsPane ? (
          <div className="flex min-h-0 w-0 min-w-full flex-1 flex-col">
            {activeSections}
          </div>
        ) : (
          <ScrollArea type="scroll" edgeFade className="sidebar-scroll h-full min-h-0 flex-1">
            <div className="flex w-0 min-w-full flex-col">
              {activeSections}
            </div>
          </ScrollArea>
        )}
      </div>
      {automationTarget && <AutomationDialog
        open onOpenChange={(open) => { if (!open) setAutomationTarget(null) }} editAutomation={null}
        projectPath={automationTarget.path} initialEnvironmentId={automationTarget.environmentId} environments={props.environments}
      />}
      {settledCount > 0 && (
        <div data-project-focus-settled className="flex min-h-0 max-h-[50%] shrink-0 flex-col">
          <SidebarSectionLabel
            section="settled"
            count={settledCount}
            countTone="plain"
            collapsed={!settledExpanded}
            onToggle={() => setSettledExpanded((value) => !value)}
            controlsId={settledPanelId}
            chevronWhenExpanded
          >
            {t('sidebar.settled')}
          </SidebarSectionLabel>
          <SidebarCollapse
            id={settledPanelId}
            open={settledExpanded}
            unmountClosed
            className="min-h-0"
            innerClassName={cn('flex h-full min-h-0 flex-col', groupSettled && 'pl-1')}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {settledSections.map(({ bucket, checkouts, sessions, count }) => {
                const body = (
                  <SettledFocusSessions bucket={bucket} checkouts={checkouts} sessions={sessions} paths={paths} props={props} />
                )
                return groupSettled ? (
                  <FocusEnvironmentGroup key={bucket.environmentId} bucket={bucket} count={count} unmountCollapsed>
                    {body}
                  </FocusEnvironmentGroup>
                ) : <div key={bucket.environmentId}>{body}</div>
              })}
            </div>
          </SidebarCollapse>
        </div>
      )}
    </div>
  )
}
