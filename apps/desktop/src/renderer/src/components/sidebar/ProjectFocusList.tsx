import { useEffect, useId, useImperativeHandle, useMemo, useState, type ReactNode, type RefObject } from 'react'
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
import { cn } from '@superone/ui/lib/utils'
import type { SidebarFocusViewProps } from './SidebarFocusView'

/** Compact section styling for focus, distinct from the full environment rows. */
export function FocusEnvironmentGroup({
  bucket, count = 0, initiallyExpanded = false, upgradingLabel, unmountCollapsed = false, revealKey = 0, onSearch, onNewAutomation, onNewSession, children,
}: {
  bucket: EnvironmentBucket
  count?: number
  initiallyExpanded?: boolean
  upgradingLabel?: string
  unmountCollapsed?: boolean
  revealKey?: number
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
    <div data-focus-environment={bucket.environmentId}>
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
      <SidebarCollapse id={panelId} open={expanded} unmountClosed={unmountCollapsed} innerClassName="pl-1">
        {children}
      </SidebarCollapse>
    </div>
  )
}

/** One environment's checkouts in project focus. The environment heading is optional. */
function ActiveFocusSessions({
  bucket, checkouts, props,
}: {
  bucket: EnvironmentBucket
  checkouts: EnvironmentBucket['checkouts']
  props: SidebarFocusViewProps
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
      {checkouts.map((checkout) => (
        <ProjectSidebarRow
          key={checkout.pathKey}
          folder={checkoutToRecentFolder(checkout)}
          repoIdentity={checkout.repoIdentity}
          sessionsOnly
          isExpanded
          showSettled={false}
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
      ))}
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
      <ScrollArea type="scroll" edgeFade data-project-focus-active className="sidebar-scroll min-h-0 flex-1">
        <div className="flex w-0 min-w-full flex-col">
        {sections.map(({ bucket, checkouts }) => {
          const target = checkouts.find((checkout) => checkout.pathKey === focusedPath && !checkout.missing)
            ?? checkouts.find((checkout) => !checkout.missing)
          const body = search && (search.environmentId === null || search.environmentId === bucket.environmentId) ? history(checkouts.map((checkout) => checkout.pathKey)) : (
            <ActiveFocusSessions
              bucket={bucket}
              checkouts={checkouts}
              props={props}
            />
          )
          return groupActive ? (
            <FocusEnvironmentGroup
              key={bucket.environmentId}
              bucket={bucket}
              initiallyExpanded
              revealKey={search && (search.environmentId === null || search.environmentId === bucket.environmentId) ? search.revealKey : 0}
              upgradingLabel={props.upgradingLabels?.[bucket.connectionId]}
              onSearch={() => setSearch((prev) => ({ environmentId: bucket.environmentId, revealKey: (prev?.revealKey ?? 0) + 1, query: prev?.query ?? '' }))}
              onNewAutomation={target ? () => setAutomationTarget({ path: target.pathKey, environmentId: bucket.environmentId }) : undefined}
              onNewSession={target ? () => props.onNewSession(target.pathKey) : undefined}
            >
              {body}
            </FocusEnvironmentGroup>
          ) : <div key={bucket.environmentId}>{body}</div>
        })}
        </div>
      </ScrollArea>
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
