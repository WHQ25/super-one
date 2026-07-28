import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Bot, Loader2, MessageSquare, Smartphone } from 'lucide-react'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useChatStore, type PerSessionState, type ProjectState } from '@/stores/chat'
import { useCtrlTabSwitcher } from '@/hooks/useCtrlTabSwitcher'
import { getPendingReason, isLiveSession, resolveSessionTitle } from '@/components/sidebar/session-state-utils'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import type { AgentStatus, HarnessId, SessionHistoryEntry } from '@superone/shared/agent-types'

interface SessionSwitcherPopupProps {
  scopeRef: RefObject<HTMLElement | null>
}

export interface ActiveRow {
  projectPath: string
  sessionId: string
  title: string
  liveSession: PerSessionState
  dbEntry: SessionHistoryEntry | undefined
  isCurrent: boolean
  isPrevious: boolean
  isRemote: boolean
  isUnseen: boolean
}

export interface SwitcherRow {
  projectPath: string
  sessionId: string
  title: string
  status: AgentStatus
  lastEventAt: number
  isCurrent: boolean
  isPrevious: boolean
  isUnseen: boolean
  isRemote: boolean
  isAutomation: boolean
  isWorktree: boolean
  provider?: HarnessId
  acpAgentId?: string | null
  pendingReason: string | null
}

export interface CollectActiveRowsInput {
  projectSessions: Record<string, ProjectState>
  remoteSessions: Record<string, ReadonlyArray<string>>
  activeProject: string | null
  previousFocusedSession: { projectPath: string; sessionId: string } | null
  agentTitles?: Record<string, string>
}

const EMPTY_ROWS: ActiveRow[] = []

interface BuildRowArgs {
  projectPath: string
  sid: string
  data: PerSessionState
  dbById: Map<string, SessionHistoryEntry>
  remoteSet: Set<string>
  isCurrent: boolean
  isPrevious: boolean
  isUnseen: boolean
  agentTitle: string | undefined
}

function buildRow({ projectPath, sid, data, dbById, remoteSet, isCurrent, isPrevious, isUnseen, agentTitle }: BuildRowArgs): ActiveRow {
  const dbEntry = dbById.get(sid)
  const title = resolveSessionTitle(agentTitle, data.messages, dbEntry?.title)
  return {
    projectPath,
    sessionId: sid,
    title,
    liveSession: data,
    dbEntry,
    isCurrent,
    isPrevious,
    isRemote: remoteSet.has(sid),
    isUnseen,
  }
}

export function collectAllActiveRows(input: CollectActiveRowsInput): ActiveRow[] {
  const { projectSessions, remoteSessions, activeProject, previousFocusedSession, agentTitles = {} } = input
  const activeProjectState = activeProject ? projectSessions[activeProject] : undefined
  const activeSid = activeProjectState?._activeSessionId ?? null
  const prevKey = previousFocusedSession
    && !(activeProject === previousFocusedSession.projectPath && activeSid === previousFocusedSession.sessionId)
    ? previousFocusedSession
    : null

  const rows: ActiveRow[] = []
  for (const [projectPath, project] of Object.entries(projectSessions)) {
    const dbById = new Map(project.sessions.map((entry) => [entry.sessionId, entry]))
    const remoteSet = new Set(remoteSessions[projectPath] ?? [])
    const isActiveProject = projectPath === activeProject
    for (const [sid, data] of Object.entries(project._sessions)) {
      const isUnseen = project.unseenCompletedSessions.has(sid)
      const isCurrent = isActiveProject && sid === activeSid
      const isPrevious = !!prevKey && prevKey.projectPath === projectPath && prevKey.sessionId === sid && !isCurrent
      // Current + previous are pinned regardless of activity / hydration state — Ctrl+Tab needs a stable home/back row.
      if (!isCurrent && !isPrevious) {
        if (!isLiveSession(data, isUnseen)) continue
        if (data.messages.length === 0 && !data._historyHydrated) continue
      }
      rows.push(buildRow({ projectPath, sid, data, dbById, remoteSet, isCurrent, isPrevious, isUnseen, agentTitle: agentTitles[sid] }))
    }
  }

  // Ensure the global previous tuple is in the list (even if idle) so Ctrl+Tab can bounce back.
  if (prevKey && !rows.some((r) => r.projectPath === prevKey.projectPath && r.sessionId === prevKey.sessionId)) {
    const project = projectSessions[prevKey.projectPath]
    const data = project?._sessions[prevKey.sessionId]
    if (project && data && (data.messages.length > 0 || data._historyHydrated)) {
      const dbById = new Map(project.sessions.map((entry) => [entry.sessionId, entry]))
      const remoteSet = new Set(remoteSessions[prevKey.projectPath] ?? [])
      const isUnseen = project.unseenCompletedSessions.has(prevKey.sessionId)
      rows.push(buildRow({
        projectPath: prevKey.projectPath,
        sid: prevKey.sessionId,
        data,
        dbById,
        remoteSet,
        isCurrent: false,
        isPrevious: true,
        isUnseen,
        agentTitle: agentTitles[prevKey.sessionId],
      }))
    }
  }

  rows.sort((a, b) => b.liveSession.lastEventAt - a.liveSession.lastEventAt)

  const currentIdx = rows.findIndex((r) => r.isCurrent)
  if (currentIdx > 0) {
    const [currentRow] = rows.splice(currentIdx, 1)
    rows.unshift(currentRow)
  }

  // Place the previous session right after current so Ctrl+Tab lands on it first.
  const newCurrentIdx = rows.findIndex((r) => r.isCurrent)
  const previousIdx = rows.findIndex((r) => r.isPrevious)
  if (previousIdx !== -1 && previousIdx !== newCurrentIdx + 1) {
    const [previousRow] = rows.splice(previousIdx, 1)
    const insertAt = newCurrentIdx === -1 ? 0 : newCurrentIdx + 1
    rows.splice(insertAt, 0, previousRow)
  }
  return rows
}

function toSwitcherRow(row: ActiveRow): SwitcherRow {
  return {
    projectPath: row.projectPath,
    sessionId: row.sessionId,
    title: row.title,
    status: row.liveSession.status,
    lastEventAt: row.liveSession.lastEventAt,
    isCurrent: row.isCurrent,
    isPrevious: row.isPrevious,
    isUnseen: row.isUnseen,
    isRemote: row.isRemote,
    isAutomation: !!row.dbEntry?.isAutomation,
    isWorktree: !!row.dbEntry?.isWorktree || !!row.liveSession._gitBranch,
    provider: row.dbEntry?.provider ?? row.liveSession.preferredProvider,
    acpAgentId: row.dbEntry?.acpAgentId ?? row.liveSession.acpAgentId ?? null,
    pendingReason: getPendingReason(
      row.liveSession.pendingPermissions,
      row.liveSession.pendingQuestion,
      row.liveSession.pendingPlanApproval,
    ),
  }
}

type FrozenKey = { projectPath: string; sessionId: string }

function rowKey(r: { projectPath: string; sessionId: string }): string {
  return `${r.projectPath}${r.sessionId}`
}

function collectFromState(state: ReturnType<typeof useChatStore.getState>): ActiveRow[] {
  return collectAllActiveRows({
    projectSessions: state.projectSessions,
    remoteSessions: state.remoteSessions,
    activeProject: state.activeProject,
    previousFocusedSession: state._previousFocusedSession,
    agentTitles: state.agentTitles,
  })
}

export function SessionSwitcherPopup({ scopeRef }: SessionSwitcherPopupProps) {
  const frozenOrderRef = useRef<FrozenKey[] | null>(null)

  const getItems = useCallback((): { count: number; currentIndex: number } | null => {
    const state = useChatStore.getState()
    const rows = collectFromState(state)
    if (rows.length === 0) return null
    const currentIdx = rows.findIndex((r) => r.isCurrent)
    if (rows.length === 1 && currentIdx === 0) return null
    frozenOrderRef.current = rows.map((r) => ({ projectPath: r.projectPath, sessionId: r.sessionId }))
    return { count: rows.length, currentIndex: currentIdx }
  }, [])

  const onCommit = useCallback((targetIndex: number) => {
    const target = frozenOrderRef.current?.[targetIndex]
    if (!target) return
    void useChatStore.getState().switchToSession(target.projectPath, target.sessionId)
  }, [])

  const { isOpen, selectedIndex } = useCtrlTabSwitcher({
    scopeRef,
    getItems,
    onCommit,
    claimWhenUnfocused: true,
  })

  useEffect(() => {
    if (!isOpen) frozenOrderRef.current = null
  }, [isOpen])

  const projectSessions = useChatStore((s) => s.projectSessions)
  const remoteSessions = useChatStore((s) => s.remoteSessions)
  const activeProject = useChatStore((s) => s.activeProject)
  const previousFocusedSession = useChatStore((s) => s._previousFocusedSession)
  const agentTitles = useChatStore((s) => s.agentTitles)
  const internalRows = useMemo<ActiveRow[]>(() => {
    if (!isOpen) return EMPTY_ROWS
    const fresh = collectAllActiveRows({ projectSessions, remoteSessions, activeProject, previousFocusedSession, agentTitles })
    const order = frozenOrderRef.current
    if (!order) return fresh
    const byKey = new Map(fresh.map((r) => [rowKey(r), r]))
    const ordered: ActiveRow[] = []
    for (const key of order) {
      const row = byKey.get(rowKey(key))
      if (row) ordered.push(row)
    }
    return ordered
  }, [isOpen, projectSessions, remoteSessions, activeProject, previousFocusedSession, agentTitles])
  const viewRows = useMemo<SwitcherRow[]>(() => internalRows.map(toSwitcherRow), [internalRows])

  return <SessionSwitcherView rows={viewRows} selectedIndex={selectedIndex} isOpen={isOpen} />
}

interface SessionSwitcherViewProps {
  rows: SwitcherRow[]
  selectedIndex: number
  isOpen: boolean
  /** Delay before the popup actually renders. Lets a quick Ctrl+Tab tap commit silently without visual flash. */
  openDelayMs?: number
}

export function SessionSwitcherView({ rows, selectedIndex, isOpen, openDelayMs = 200 }: SessionSwitcherViewProps) {
  const [isVisible, setIsVisible] = useState(false)
  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false)
      return
    }
    if (openDelayMs <= 0) {
      setIsVisible(true)
      return
    }
    const timer = setTimeout(() => setIsVisible(true), openDelayMs)
    return () => clearTimeout(timer)
  }, [isOpen, openDelayMs])

  return (
    <AnimatePresence>
      {isVisible && rows.length > 0 ? (
        <motion.div
          key="session-switcher"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="w-105 max-w-[80vw] max-h-[70vh] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Switch Between working sessions
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Kbd>ctrl</Kbd>
                <span className="text-xs text-muted-foreground">+</span>
                <Kbd>tab</Kbd>
              </div>
            </div>
            <SessionList rows={rows} selectedIndex={selectedIndex} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function SessionList({ rows, selectedIndex }: { rows: SwitcherRow[]; selectedIndex: number }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-row-idx="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div ref={containerRef} className="overflow-y-auto py-1 max-h-[calc(70vh-44px)]">
      {rows.map((row, idx) => (
        <SessionRow key={`${row.projectPath}${row.sessionId}`} row={row} idx={idx} isSelected={idx === selectedIndex} />
      ))}
    </div>
  )
}

function SessionRow({ row, idx, isSelected }: { row: SwitcherRow; idx: number; isSelected: boolean }) {
  return (
    <div
      data-row-idx={idx}
      className={cn(
        'flex flex-col gap-1 px-3 py-2 transition-colors',
        isSelected ? 'bg-accent text-accent-foreground' : '',
      )}
    >
      <div className="flex items-center gap-2">
        <SessionStatusIcon
          status={row.status}
          lastEventAt={row.lastEventAt}
          isUnseen={row.isUnseen}
          isAutomation={row.isAutomation}
          isRemote={row.isRemote}
          provider={row.provider}
          acpAgentId={row.acpAgentId}
        />
        <span className="min-w-0 flex-1 truncate text-xs">{row.title}</span>
        {row.isCurrent ? (
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Current</span>
        ) : row.isPrevious ? (
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Previous</span>
        ) : null}
      </div>
      {row.pendingReason ? (
        <div className="ml-5 flex items-center gap-1 rounded-md bg-green-500/15 px-2 py-1">
          <Bot className="size-3 shrink-0 text-green-600 dark:text-green-400" />
          <span className="min-w-0 truncate text-xs text-green-600 dark:text-green-400">{row.pendingReason}</span>
        </div>
      ) : null}
    </div>
  )
}

interface SessionStatusIconProps {
  status: AgentStatus
  lastEventAt: number
  isUnseen: boolean
  isAutomation: boolean
  isRemote: boolean
  provider?: HarnessId
  acpAgentId?: string | null
}

function SessionStatusIcon({ status, lastEventAt, isUnseen, isAutomation, isRemote, provider, acpAgentId }: SessionStatusIconProps) {
  const stallLevel = useStallLevel(status === 'streaming', lastEventAt)
  const isRunning = status === 'streaming'
  const isBackground = status === 'background'
  if (isRemote) {
    return <Smartphone className="size-3 shrink-0 text-muted-foreground" />
  }
  const harnessStatus: SessionIconProps['status'] = isRunning
    ? 'running'
    : isBackground
      ? 'background'
      : isUnseen
        ? 'unseen'
        : isAutomation
          ? 'automation'
          : 'default'
  const HarnessIcon = resolveSessionIcon(provider, acpAgentId)
  if (HarnessIcon && harnessStatus !== 'default') {
    return <HarnessIcon status={harnessStatus} renderLevel="compact" />
  }
  if (isRunning) {
    return <Loader2 className={cn('size-3 shrink-0 animate-spin', getStallColor(stallLevel, 'text-muted-foreground'))} />
  }
  return <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
}
