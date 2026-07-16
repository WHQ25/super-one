import { memo, useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ChevronDown, ChevronRight, ChevronUp, Folder, FolderOpen, FolderX, History, Pencil, Play, SquarePen, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppWorkerGroup } from './MiniAppWorkerGroup'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'
import type { Automation, RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { DEFAULT_SESSION_TITLE, getSessionTitle, isLiveSession } from './session-state-utils'
import { AutomationDialog } from '../AutomationDialog'
import { SessionRow, type SessionRowCallbacks } from './SessionRow'
import { ProjectHistoryList } from './ProjectHistoryList'

function MorphHeight({ children, morphKey }: { children: React.ReactNode; morphKey: unknown }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const prevKeyRef = useRef(morphKey)
  const pendingFromRef = useRef<number | null>(null)
  const animationRef = useRef<Animation | null>(null)

  if (prevKeyRef.current !== morphKey) {
    prevKeyRef.current = morphKey
    pendingFromRef.current = innerRef.current?.offsetHeight ?? null
  }

  useLayoutEffect(() => {
    const from = pendingFromRef.current
    pendingFromRef.current = null
    if (from == null || !outerRef.current || !innerRef.current) return
    const to = innerRef.current.offsetHeight
    if (from === to || typeof outerRef.current.animate !== 'function') return
    animationRef.current?.cancel()
    animationRef.current = outerRef.current.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 160, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )
  })

  return (
    <div ref={outerRef} style={{ overflow: 'hidden' }}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}

interface ProjectSidebarRowProps extends SessionRowCallbacks {
  folder: RecentFolder
  isExpanded: boolean
  sessions: SessionHistoryEntry[]
  maxSessions: number
  onToggleExpand: (folderPath: string) => void
  onRemoveProject: (folder: RecentFolder) => void
  onNewSession: (folderPath: string) => void
}

export const ProjectSidebarRow = memo(function ProjectSidebarRow({
  folder,
  isExpanded,
  sessions: allSessions,
  maxSessions,
  onToggleExpand,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onRemoveProject,
  onRenameSession,
  onDeleteSession,
  onNewSession,
}: ProjectSidebarRowProps) {
  const { t } = useTranslation()
  const liveSessionSig = useChatStore(useShallow((s) => {
    const proj = s.projectSessions[folder.path]
    const sig: Record<string, string> = {}
    if (proj?._sessions) {
      for (const [sid, data] of Object.entries(proj._sessions)) {
        if (data.messages.length === 0) continue
        sig[sid] = [
          data.status ?? '',
          data.messages.length,
          data._historyHydrated ? 1 : 0,
          proj.unseenCompletedSessions.has(sid) ? 1 : 0,
          (data.pendingPermissions?.length ?? 0) > 0 ? 1 : 0,
          data.pendingQuestion ? 1 : 0,
          data.pendingPlanApproval ? 1 : 0,
          data.awaitingAssistantReply ? 1 : 0,
          data.sessionProvider ?? '',
          data.session?.sessionId ?? '',
          data._gitBranch ?? '',
          data._worktreePath ?? '',
          getSessionTitle(data.messages) ?? '',
        ].join('\x01')
      }
    }
    return sig
  }))

  const INITIAL_EXPAND_LEVEL = 6
  const [expandLevel, setExpandLevel] = useState<number>(INITIAL_EXPAND_LEVEL)
  const [historyMode, setHistoryMode] = useState(false)

  useEffect(() => {
    if (!isExpanded) setExpandLevel(INITIAL_EXPAND_LEVEL)
  }, [isExpanded])

  const openHistory = useCallback(() => {
    setHistoryMode(true)
    if (!isExpanded) onToggleExpand(folder.path)
  }, [isExpanded, onToggleExpand, folder.path])

  const derived = useMemo(() => {
    const projectSession = useChatStore.getState().projectSessions[folder.path]
    const dbVisibleSessions = allSessions.filter((session) => !session.isHidden)
    const dbSessionById = new Map(allSessions.map((session) => [session.sessionId, session]))
    let sessions = dbVisibleSessions

    if (projectSession?._sessions) {
      const live: SessionHistoryEntry[] = []
      for (const [sid, data] of Object.entries(projectSession._sessions)) {
        if (data.messages.length === 0) continue
        const title = getSessionTitle(data.messages)
        const dbEntry = dbSessionById.get(sid)
        if (dbEntry?.isHidden) continue
        if (dbEntry) continue
        const isUnseen = projectSession.unseenCompletedSessions.has(sid)
        if (!isLiveSession(data, isUnseen)) continue
        if (!title && !data._historyHydrated) continue
        live.push({
          sessionId: sid,
          title: title ?? DEFAULT_SESSION_TITLE,
          lastActiveAt: new Date().toISOString(),
          provider: data.sessionProvider ?? undefined,
          providerSessionId: data._providerSessionId ?? undefined,
          messageCount: data.messages.length,
          isWorktree: !!data._gitBranch,
          gitBranch: data._gitBranch ?? undefined,
          worktreePath: data._worktreePath ?? undefined,
        })
      }
      if (live.length > 0) sessions = [...live, ...sessions]
    }

    const liveSessions = isExpanded ? [] : sessions.filter((session) => {
      const entry = projectSession?._sessions?.[session.sessionId]
      const isUnseen = projectSession?.unseenCompletedSessions?.has(session.sessionId)
      if (!entry && !isUnseen) return false
      return isLiveSession(entry, isUnseen)
    })

    const displayLimit = Math.min(expandLevel, maxSessions)
    return {
      displayPath: homePath(folder.path),
      sessionsToShow: isExpanded ? sessions.slice(0, displayLimit) : liveSessions,
      showSessions: isExpanded || liveSessions.length > 0,
      totalCount: sessions.length,
      hasMoreThanInitial: sessions.length > expandLevel,
      hasOverflow: sessions.length > maxSessions,
    }
  }, [allSessions, folder.path, isExpanded, maxSessions, liveSessionSig, expandLevel])

  const allWorkers = useMiniAppStore((s) => s.workers)
  const projectWorkers = useMemo(
    () => allWorkers.filter((w) => w.projectDir === folder.path),
    [allWorkers, folder.path],
  )
  const handleStopWorker = useCallback((appId: string) => {
    window.miniapp.workerStop(folder.path, appId).catch(() => {})
  }, [folder.path])

  const handleOpenWorkerApp = useCallback((appId: string) => {
    const entry = useMiniAppStore.getState().apps.find((a) => a.id === appId)
    if (entry) useMiniAppStore.getState().openAppInPanel(entry, folder.path).catch(() => {})
  }, [folder.path])

  const [projectAutomations, setProjectAutomations] = useState<Automation[]>([])
  const [automationsExpanded, setAutomationsExpanded] = useState(false)
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)

  const refreshAutomations = useCallback(() => {
    if (folder.missing) return
    window.app.listAutomations(folder.path).then((next) => {
      setProjectAutomations((prev) => {
        if (prev.length !== next.length) return next
        for (let i = 0; i < prev.length; i++) {
          const a = prev[i]
          const b = next[i]
          if (a.id !== b.id || a.updatedAt !== b.updatedAt || a.lastRunStatus !== b.lastRunStatus || a.enabled !== b.enabled) {
            return next
          }
        }
        return prev
      })
    }).catch(() => {})
  }, [folder.path, folder.missing])

  useEffect(() => {
    if (isExpanded) refreshAutomations()
  }, [isExpanded, refreshAutomations])

  const openCreateDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingAutomation(null)
    setAutomationDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((automation: Automation) => {
    setEditingAutomation(automation)
    setAutomationDialogOpen(true)
  }, [])

  const folderMenuItems: AdaptiveMenuEntry[] = [
    ...(!folder.missing
      ? ([
          { kind: 'item', id: 'history', label: t('sidebar.contextMenu.sessionHistory'), icon: History, onSelect: openHistory },
          { kind: 'separator' },
        ] as AdaptiveMenuEntry[])
      : []),
    { kind: 'item', id: 'remove', label: t('sidebar.contextMenu.removeProject'), icon: Trash2, destructive: true, onSelect: () => onRemoveProject(folder) },
  ]

  return (
    <div>
      <AdaptiveContextMenu items={folderMenuItems} contentClassName="w-48">
          <div
            onClick={() => {
              if (folder.missing) return
              if (historyMode) setHistoryMode(false)
              onToggleExpand(folder.path)
            }}
            className={cn(
              'group flex h-9 items-center overflow-hidden rounded-md px-2.5 transition-colors',
              folder.missing ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-sidebar-accent/80'
            )}
          >
            <ChevronRight className={cn(
              'hidden size-4 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-hover:block',
              isExpanded && 'rotate-90',
              folder.missing && '!hidden'
            )} />
            {folder.missing
              ? <FolderX className="size-4.5 shrink-0 text-destructive" />
              : isExpanded
                ? <FolderOpen className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
                : <Folder className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
            }
            <TooltipProvider delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn('ml-2 min-w-0 truncate text-md', folder.missing && 'text-muted-foreground line-through')}>{folder.name}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <span className="text-xs">{folder.missing ? t('tooltips.folderNotFound', { path: folder.path }) : derived.displayPath}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {!folder.missing && (
              <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <IconButton
                  size="md"
                  variant="nested"
                  tooltip={t('tooltips.newAutomation')}
                  tooltipSideOffset={8}
                  onClick={openCreateDialog}
                >
                  <CalendarClock />
                </IconButton>
                <IconButton
                  size="md"
                  variant="nested"
                  tooltip={t('tooltips.newSession')}
                  tooltipSideOffset={8}
                  onClick={(e) => {
                    e.stopPropagation()
                    onNewSession(folder.path)
                  }}
                >
                  <SquarePen />
                </IconButton>
              </div>
            )}
          </div>
      </AdaptiveContextMenu>

      {isExpanded && projectAutomations.length > 0 && (
        <div className="overflow-hidden pl-2.5">
          <button
            onClick={() => setAutomationsExpanded((v) => !v)}
            className="group/auto flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/80 hover:text-sidebar-foreground/70"
          >
            <ChevronRight className={cn(
              'hidden size-3.5 shrink-0 transition-transform duration-200 group-hover/auto:block',
              automationsExpanded && 'rotate-90',
            )} />
            <CalendarClock className="size-3.5 shrink-0 group-hover/auto:hidden" />
            <span>{t('sidebar.contextMenu.automations')}</span>
            <span className="ml-auto text-[10px] text-sidebar-foreground/30">{projectAutomations.length}</span>
          </button>
          {automationsExpanded && (
            <div className="flex flex-col py-0.5 pl-2">
              {projectAutomations.map((automation) => {
                const automationMenuItems: AdaptiveMenuEntry[] = [
                  { kind: 'item', id: 'run', label: t('sidebar.contextMenu.runNow'), icon: Play, onSelect: () => { window.app.runAutomationNow(automation.id).catch(() => {}) } },
                  { kind: 'item', id: 'edit', label: t('sidebar.contextMenu.edit'), icon: Pencil, onSelect: () => openEditDialog(automation) },
                  { kind: 'separator' },
                  { kind: 'item', id: 'delete', label: t('sidebar.contextMenu.delete'), icon: Trash2, destructive: true, onSelect: () => { window.app.deleteAutomation(automation.id).then(refreshAutomations).catch(() => {}) } },
                ]
                return (
                <AdaptiveContextMenu key={automation.id} items={automationMenuItems}>
                    <button
                      onClick={() => openEditDialog(automation)}
                      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-accent/80"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <CalendarClock className="size-3 shrink-0 text-sidebar-foreground/50" />
                        <span className="truncate">{automation.name}</span>
                      </span>
                      <span className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        automation.lastRunStatus === 'error' ? 'bg-red-500' :
                        automation.lastRunStatus === 'running' ? 'bg-yellow-500' :
                        automation.enabled ? 'bg-green-500' : 'bg-muted-foreground/30',
                      )} />
                    </button>
                </AdaptiveContextMenu>
                )
              })}
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <MiniAppWorkerGroup
          workers={projectWorkers}
          onOpen={handleOpenWorkerApp}
          onStop={handleStopWorker}
        />
      )}

      <MorphHeight morphKey={historyMode}>
        {historyMode ? (
          <ProjectHistoryList
            folderPath={folder.path}
            initialSessions={allSessions}
            onClose={() => setHistoryMode(false)}
            onSwitchSession={onSwitchSession}
            onPinSession={onPinSession}
            onHideSession={onHideSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        ) : derived.showSessions ? (
          <div className="flex flex-col py-0.5 pl-2.5">
            {derived.sessionsToShow.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>
            ) : (
              derived.sessionsToShow.map((session) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  folderPath={folder.path}
                  onSwitchSession={onSwitchSession}
                  onPinSession={onPinSession}
                  onHideSession={onHideSession}
                  onRenameSession={onRenameSession}
                  onDeleteSession={onDeleteSession}
                />
              ))
            )}
            {isExpanded && expandLevel < maxSessions && derived.hasMoreThanInitial && (
              <button
                onClick={() => setExpandLevel(maxSessions)}
                className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/80 hover:text-sidebar-foreground/70"
              >
                <ChevronDown className="size-3.5 shrink-0" />
                <span>{t('sidebar.contextMenu.showMore')}</span>
              </button>
            )}
            {isExpanded && expandLevel >= maxSessions && derived.totalCount > INITIAL_EXPAND_LEVEL && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setExpandLevel(INITIAL_EXPAND_LEVEL)}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/80 hover:text-sidebar-foreground/70"
                >
                  <ChevronUp className="size-3.5 shrink-0" />
                  <span>{t('sidebar.contextMenu.showLess')}</span>
                </button>
                {derived.hasOverflow && (
                  <IconButton
                    size="md"
                    tooltip={t('sidebar.contextMenu.sessionHistory')}
                    onClick={openHistory}
                  >
                    <History />
                  </IconButton>
                )}
              </div>
            )}
          </div>
        ) : null}
      </MorphHeight>

      <AutomationDialog
        open={automationDialogOpen}
        onOpenChange={setAutomationDialogOpen}
        editAutomation={editingAutomation}
        projectPath={folder.path}
        onSaved={refreshAutomations}
      />
    </div>
  )
})
