import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { presenterFor } from '@/lib/multi-host/session-hover'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { ActiveSessionList } from './ActiveSessionList'
import { FocusEnvironmentGroup } from './ProjectFocusList'
import { SessionRow } from './SessionRow'
import type { SidebarFocusViewProps } from './SidebarFocusView'
import { useFocusSessionChildren, type FocusChildProject } from './use-focus-session-children'

export function SessionFocusList({ folderPath, sessionId, props }: {
  folderPath: string
  sessionId: string
  props: SidebarFocusViewProps
}) {
  const { t } = useTranslation()
  const sections = useMemo(() => {
    const buckets = props.environments.map((bucket) => ({
      bucket,
      projects: bucket.checkouts.filter((checkout) => !checkout.missing).map((checkout) => ({
        path: checkout.pathKey, projectId: checkout.projectId, connected: bucket.connection === 'connected',
      })),
    }))
    const known = new Set(buckets.flatMap((section) => section.projects.map((project) => project.path)))
    for (const path of new Set([folderPath, ...props.folders.map((folder) => folder.path)])) {
      if (known.has(path)) continue
      const connectionId = parseRemoteProjectKey(path)?.connectionId ?? 'local'
      let section = buckets.find((section) => section.bucket.connectionId === connectionId)
      if (!section) {
        const bucket: EnvironmentBucket = {
          environmentId: connectionId, connectionId, label: connectionId === 'local' ? props.localHostLabel : connectionId,
          kind: connectionId === 'local' ? 'local' : 'cli-node', connection: 'connected',
          projectsStatus: 'ready', projectsError: null, checkouts: [],
        }
        section = { bucket, projects: [] }
        buckets.push(section)
      }
      section.projects.push({ path, projectId: props.folders.find((folder) => folder.path === path)?.id ?? '', connected: section.bucket.connection === 'connected' })
    }
    return buckets
  }, [folderPath, props.environments, props.folders, props.localHostLabel])
  const projects = useMemo(() => sections.flatMap((section) => section.projects), [sections])
  const initial = Object.fromEntries(projects.flatMap((project) => {
    const sessions = props.childSessions?.[project.path]?.[sessionId]
    return sessions ? [[project.path, { sessions, hasMore: props.childSessionsHasMore?.[project.path]?.[sessionId] === true }]] : []
  }))
  const { pages, load } = useFocusSessionChildren(sessionId, projects, initial)
  const pending = projects.some((project) => project.connected && (!pages[project.path] || pages[project.path]?.loading))
  const visible = sections.filter((section) => section.bucket.connection === 'offline' || section.projects.some((project) => pages[project.path]?.sessions.length || pages[project.path]?.error))
  const grouped = visible.length > 1

  const projectRows = (project: FocusChildProject, bucket: EnvironmentBucket) => {
    const page = pages[project.path]
    const name = props.folders.find((folder) => folder.path === project.path)?.name
      ?? bucket.checkouts.find((checkout) => checkout.pathKey === project.path)?.name ?? ''
    const present = presenterFor(bucket, name, project.path)
    return page?.sessions.map((child) => {
      const presentation = present(child)
      return <SessionRow
        key={`${project.path}:${child.sessionId}`}
        session={child}
        folderPath={project.path}
        childSession
        opening={props.openingSession?.folderPath === project.path && props.openingSession.sessionId === child.sessionId}
        onSwitchSession={(path, id) => props.onSwitchSession(path, id, { revealProject: false })}
        onPinSession={props.onPinSession}
        onSettleSession={props.onSettleSession}
        onRenameSession={props.onRenameSession}
        onDeleteSession={props.onDeleteSession}
        hover={presentation.hover}
        environmentOffline={presentation.environmentOffline}
        focusEnvironmentId={bucket.environmentId}
      />
    })
  }
  return (
    <ScrollArea type="scroll" edgeFade className="sidebar-scroll h-full min-h-0 flex-1" data-session-focus-children>
      {visible.map(({ bucket, projects }) => {
        const body = (
          <>
            {bucket.connection === 'offline' && projects.every((project) => !pages[project.path]?.sessions.length) && (
              <button type="button" className="px-2.5 py-2 text-left text-xs text-sidebar-foreground/70" onClick={() => props.onToggleConnection(bucket.connectionId, bucket.connection)}>
                {t('sidebar.sessionOffline')}
              </button>
            )}
            <ActiveSessionList
              kind="child"
              hasMore={projects.some((project) => project.connected && pages[project.path]?.hasMore)}
              onLoadMore={() => Promise.all(projects.map((project) => load(project, true))).then(() => {})}
            >
              {projects.flatMap((project) => projectRows(project, bucket) ?? [])}
            </ActiveSessionList>
            {projects.some((project) => pages[project.path]?.error) && (
              <button type="button" className="px-2.5 py-2 text-left text-xs text-sidebar-foreground/70" onClick={() => {
                for (const project of projects) if (pages[project.path]?.error) void load(project)
              }}>{t('sidebar.focusChildrenLoadFailed')}</button>
            )}
          </>
        )
        return grouped
          ? <FocusEnvironmentGroup key={bucket.environmentId} bucket={bucket} initiallyExpanded>{body}</FocusEnvironmentGroup>
          : <div key={bucket.environmentId}>{body}</div>
      })}
      {pending && <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('common.loading')}</div>}
      {!pending && visible.length === 0 && <div className="px-2.5 py-2 text-xs text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>}
    </ScrollArea>
  )
}
