import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { checkoutToRecentFolder } from '@/lib/multi-host/checkout-folder'
import { sortCheckouts } from '@/lib/multi-host/group-projects'
import { presenterFor } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { EnvironmentKindIcon, EnvironmentUpgradingIcon } from './multi-host/EnvironmentKindIcon'
import { ProjectSidebarRow, type ProjectFocusActions } from './ProjectSidebarRow'
import { SettledSessionList } from './SettledSection'
import { SidebarSectionLabel } from './SidebarSectionLabel'
import type { SidebarFocusViewProps } from './SidebarFocusView'

/** Compact section styling for focus, distinct from the full environment rows. */
export function FocusEnvironmentGroup({
  bucket, count = 0, initiallyExpanded = false, upgradingLabel, unmountCollapsed = false, revealKey = 0, children,
}: {
  bucket: EnvironmentBucket
  count?: number
  initiallyExpanded?: boolean
  upgradingLabel?: string
  unmountCollapsed?: boolean
  revealKey?: number
  children: ReactNode
}) {
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
        icon={upgradingLabel
          ? <EnvironmentUpgradingIcon label={upgradingLabel} className="size-3" />
          : <EnvironmentKindIcon {...bucket} className="size-3 text-sidebar-foreground/45" />}
      >
        {bucket.label}
      </SidebarSectionLabel>
      <div id={panelId} hidden={!expanded} inert={!expanded ? true : undefined} className="pl-1">
        {(!unmountCollapsed || expanded) && children}
      </div>
    </div>
  )
}

/** One environment's checkouts in project focus. The environment heading is optional. */
function ActiveFocusSessions({
  bucket, checkouts, focusedPath, checkoutActionsRef, props,
}: {
  bucket: EnvironmentBucket
  checkouts: EnvironmentBucket['checkouts']
  focusedPath: string
  checkoutActionsRef: RefObject<ProjectFocusActions | null>
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
          focusActionsRef={checkout.pathKey === focusedPath ? checkoutActionsRef : undefined}
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
  const checkoutActionsRef = useRef<ProjectFocusActions | null>(null)
  const [revealKey, setRevealKey] = useState(0)
  useImperativeHandle(actionsRef, () => ({
    openHistory: () => {
      setRevealKey((value) => value + 1)
      checkoutActionsRef.current?.openHistory()
    },
    openAutomation: () => checkoutActionsRef.current?.openAutomation(),
  }), [])
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

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-0.5">
      <ScrollArea type="scroll" edgeFade data-project-focus-active className="sidebar-scroll min-h-0 flex-1">
        {sections.map(({ bucket, checkouts }) => {
          const body = (
            <ActiveFocusSessions
              bucket={bucket}
              checkouts={checkouts}
              focusedPath={focusedPath}
              checkoutActionsRef={checkoutActionsRef}
              props={props}
            />
          )
          return groupActive ? (
            <FocusEnvironmentGroup key={bucket.environmentId} bucket={bucket} initiallyExpanded revealKey={checkouts.some((checkout) => checkout.pathKey === focusedPath) ? revealKey : 0} upgradingLabel={props.upgradingLabels?.[bucket.connectionId]}>
              {body}
            </FocusEnvironmentGroup>
          ) : <div key={bucket.environmentId}>{body}</div>
        })}
      </ScrollArea>
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
          <div id={settledPanelId} hidden={!settledExpanded} className={groupSettled ? 'min-h-0 overflow-y-auto pl-1' : 'min-h-0 overflow-y-auto'}>
            {settledExpanded && settledSections.map(({ bucket, checkouts, sessions, count }) => {
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
        </div>
      )}
    </div>
  )
}
