import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { FolderPlus, Search, SquarePen } from 'lucide-react-native'
import type { RelayClient } from '@superone/relay-client'
import { Text } from '../ui/text'
import type { Project } from '../project-types'
import type { SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { IconButton, SwipeSessionRow } from '../ui'
import { SessionRowContent } from '../ui/session-row-content'
import { useMobileLocale } from '../i18n/context'
import { WorkspaceProjectRow } from './workspace-project-row'
import { readPinnedSessions } from './workspace-data'

export type WorkspaceListProps = {
  client: RelayClient | null
  projects: Project[]
  activeProject: Project | null
  activeSessionId: string | null
  /** Rows the shell already holds for the active project; seeds its row. */
  sessions: SessionListRow[]
  /** The panel is on screen. A hidden drawer has no reason to read anything. */
  visible: boolean
  /**
   * Bumped by the shell when the host reports a session-list change (and once
   * after a reconnect). The lists are re-read on a bump, not on every open —
   * opening a drawer nothing has changed under costs no request at all.
   */
  listRevision: number
  onNewSession: (project: Project) => void | Promise<void>
  onOpenSession: (project: Project, session: SessionListRow) => void | Promise<void>
  onPinSession: (project: Project, session: SessionListRow, pinned: boolean) => Promise<boolean>
  onArchiveSession: (project: Project, session: SessionListRow) => Promise<boolean>
  onDeleteSession: (project: Project, session: SessionListRow) => Promise<boolean>
  onSearch: () => void
  onAddProject: () => void
  /**
   * Run before anything that takes the user elsewhere. The drawer closes itself
   * first; the persistent sidebar has nothing to close and leaves it unset.
   */
  onLeave?: () => void
}

/**
 * Every project and every session the paired desktop has — the mobile
 * equivalent of the desktop sidebar's contents, without a container.
 *
 * It is bodiless on purpose: the phone mounts it inside a modal drawer, the
 * landscape/tablet shell mounts the same thing in a persistent pane. Those are
 * two ways of showing one surface, not two surfaces, so neither owns the list.
 */
export function WorkspaceList(props: WorkspaceListProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  // Several projects may stand open at once, as on the desktop. Becoming
  // visible adds the project the user is in without disturbing the rest, so
  // landing on your own work never costs someone else's expansion.
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [pinned, setPinned] = useState<SessionListRow[]>([])
  const activePath = props.activeProject?.path
  const { visible } = props
  useEffect(() => {
    if (!visible || !activePath) return
    setExpandedPaths((current) => current.has(activePath) ? current : new Set([...current, activePath]))
  }, [visible, activePath])

  const { client } = props
  const refreshPinned = useCallback(() => {
    if (!client) return
    readPinnedSessions(client).then(setPinned).catch(() => { /* the section just stays as it was */ })
  }, [client])

  // The project lists live in the rows; this covers only the cross-project
  // Pinned section, which has no other loader. `-1` so the first paint loads it.
  const syncedRevision = useRef(-1)
  useEffect(() => {
    if (!visible || syncedRevision.current === props.listRevision) return
    syncedRevision.current = props.listRevision
    refreshPinned()
  }, [visible, props.listRevision, refreshPinned])

  const { onLeave } = props
  const leave = (run: () => void) => { onLeave?.(); run() }
  /**
   * The project a pinned row lives in. `list_pinned_sessions` is cross-project
   * and always names one, so a row without it has nothing to act on — rather
   * than inventing a project for it, the row is dropped.
   */
  const pinnedProject = (session: SessionListRow): Project | null =>
    session.projectPath
      ? props.projects.find((item) => item.path === session.projectPath)
        ?? { path: session.projectPath, name: session.projectName ?? session.projectPath }
      : null
  /** Pin, hide and delete also move rows in the Pinned section above. */
  const listActionsFor = (project: Project) => ({
    onOpenSession: (session: SessionListRow) => leave(() => void props.onOpenSession(project, session)),
    onPinSession: (session: SessionListRow, next: boolean) =>
      props.onPinSession(project, session, next).then((ok) => { if (ok) refreshPinned(); return ok }),
    onArchiveSession: (session: SessionListRow) =>
      props.onArchiveSession(project, session).then((ok) => { if (ok) refreshPinned(); return ok }),
    onDeleteSession: (session: SessionListRow) =>
      props.onDeleteSession(project, session).then((ok) => { if (ok) refreshPinned(); return ok }),
  })

  return <>
    {/* Search is global and lives on its own screen, so this is a button that
        looks like a field, not a field. New session sits beside it. Both sit
        at the top; the device readout stays at the bottom of the pane. */}
    <View testID="workspace-session-actions" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Search all sessions')}
        onPress={() => leave(props.onSearch)}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40,
          paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 })}>
        <Search size={15} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{t('Search sessions')}</Text>
      </Pressable>
      {props.activeProject ? <IconButton icon={SquarePen} label="New session"
        onPress={() => leave(() => void props.onNewSession(props.activeProject!))} chrome="plain" color={colors.foreground} /> : null}
    </View>

    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 16 }}>
      {pinned.length ? <View style={{ paddingBottom: 6 }}>
        <Text style={{ paddingHorizontal: 12, paddingBottom: 2, color: colors.mutedForeground, fontSize: 12 }}>{t('Pinned')}</Text>
        {/* The same swipe the project lists carry, so unpinning happens where
            the pin is visible instead of only where the session lives. */}
        {pinned.map((session) => {
          const project = pinnedProject(session)
          if (!project) return null
          const actions = listActionsFor(project)
          return <SwipeSessionRow
            key={session.sessionId}
            title={session.title}
            pinned={session.isPinned ?? true}
            onPress={() => actions.onOpenSession(session)}
            onPin={() => { void actions.onPinSession(session, false) }}
            onArchive={() => { void actions.onArchiveSession(session) }}
            onDelete={() => { void actions.onDeleteSession(session) }}
          >
            {({ revealed }) => <SessionRowContent
              item={{ session: { ...session, isPinned: true }, child: false, hasChildren: false, collapsed: false }}
              selected={session.sessionId === props.activeSessionId}
              surface="panel"
              revealed={revealed}
              branded
              subtitle={session.projectName}
            />}
          </SwipeSessionRow>
        })}
      </View> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 2, paddingBottom: 2 }}>
        <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>{t('Projects')}</Text>
        <IconButton icon={FolderPlus} label="Add project" onPress={() => leave(props.onAddProject)} chrome="plain" color={colors.mutedForeground} />
      </View>
      {!props.projects.length ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>{t('No projects yet. Add one to start a session.')}</Text> : null}
      {props.projects.map((project) => <WorkspaceProjectRow
        key={project.path}
        client={client}
        project={project}
        expanded={expandedPaths.has(project.path)}
        onToggle={() => setExpandedPaths((current) => {
          const next = new Set(current)
          if (!next.delete(project.path)) next.add(project.path)
          return next
        })}
        seed={project.path === activePath ? props.sessions : undefined}
        activeSessionId={props.activeSessionId}
        visible={visible}
        listRevision={props.listRevision}
        {...listActionsFor(project)}
      />)}
    </ScrollView>
  </>
}
