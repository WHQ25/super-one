import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Virtualizer, WorkerPoolContextProvider, type WorkerInitializationRenderOptions } from '@pierre/diffs/react'
import { AlertTriangle, FileDiff as FileDiffIcon, RefreshCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type {
  ReviewFileDiff,
  ReviewScope,
  ReviewSessionData,
  ReviewWorkspaceData,
  ReviewWorkspaceMode,
} from '@superone/shared/review-types'
import { Button } from '@superone/ui/components/ui/button'
import { useAppStore } from '@/stores/app'
import { useChatStore, type ReplyComment } from '@/stores/chat'
import { ReviewDiffCanvas } from './ReviewDiffCanvas'
import { ReviewFileSidebar } from './ReviewFileSidebar'
import { ReviewToolbar, type DiffStylePreference } from './ReviewToolbar'
import {
  countCommentsByFile,
  maxLineNumberDigitsForFiles,
  measureDiffCharWidthPx,
  resolveAutoDiffStyle,
} from './review-diff-utils'

const TWO_COLUMN_BREAKPOINT_PX = 760
const EMPTY_COMMENTS: ReplyComment[] = []
const VIRTUALIZER_STYLE = { height: '100%', overflow: 'auto' } as const
const WORKER_POOL_OPTIONS = {
  poolSize: 4,
  workerFactory: () =>
    new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
      type: 'module',
    }),
}
const WORKER_HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  langs: ['typescript', 'tsx', 'javascript', 'jsx', 'json', 'markdown'],
  theme: { light: 'pierre-light', dark: 'pierre-dark' },
  useTokenTransformer: true,
}

export interface ReviewPanelProps {
  sessionId?: string
  projectPath?: string
  initialScope?: ReviewScope
  initialSessionData?: ReviewSessionData | null
  initialWorkspaceData?: ReviewWorkspaceData | null
  initialLoading?: boolean
  initialError?: string | null
}

export function ReviewPanel({
  sessionId: propSessionId,
  projectPath: propProjectPath,
  initialScope = 'workspace',
  initialSessionData,
  initialWorkspaceData,
  initialLoading,
  initialError,
}: ReviewPanelProps) {
  const { t } = useTranslation()
  const activeProject = useAppStore((s) => s.currentFolder)
  const projectPath = propProjectPath ?? activeProject ?? ''

  const sessionState = useChatStore(useShallow((s) => {
    const proj = projectPath ? s.projectSessions[projectPath] : undefined
    const sid = propSessionId ?? proj?._activeSessionId ?? null
    return sid && proj ? { id: sid, session: proj._sessions[sid] } : null
  }))
  const sessionId = sessionState?.id ?? propSessionId ?? null
  const sessionStatus = sessionState?.session?.status ?? 'idle'
  const sessionCwd = sessionState?.session?._worktreePath || sessionState?.session?.cwd || projectPath
  const sessionMessages = sessionState?.session?.messages
  const replyComments = sessionState?.session?.replyComments ?? EMPTY_COMMENTS

  const [scope, setScope] = useState<ReviewScope>(initialScope)
  const [workspaceMode, setWorkspaceMode] = useState<ReviewWorkspaceMode>('uncommitted')
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null)
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [diffPref, setDiffPref] = useState<DiffStylePreference>('auto')
  const [fileTreeOpen, setFileTreeOpen] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)
  const [richPreview, setRichPreview] = useState(false)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set())
  const initializedScopeKeyRef = useRef<string | null>(null)
  const fileRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const [sessionData, setSessionData] = useState<ReviewSessionData | null>(initialSessionData ?? null)
  const [workspaceData, setWorkspaceData] = useState<ReviewWorkspaceData | null>(initialWorkspaceData ?? null)
  const [loading, setLoading] = useState(initialLoading ?? false)
  const [error, setError] = useState<string | null>(initialError ?? null)

  const containerRef = useRef<HTMLDivElement>(null)
  const diffPaneRef = useRef<HTMLDivElement | null>(null)
  const [diffPaneEl, setDiffPaneEl] = useState<HTMLDivElement | null>(null)
  const handleDiffPaneRef = useCallback((el: HTMLDivElement | null) => {
    diffPaneRef.current = el
    setDiffPaneEl(el)
  }, [])
  const [containerWidth, setContainerWidth] = useState(960)
  const [diffPaneWidth, setDiffPaneWidth] = useState(720)
  const [diffCharWidthPx, setDiffCharWidthPx] = useState(() => measureDiffCharWidthPx())
  const prevStatusRef = useRef(sessionStatus)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setContainerWidth(el.clientWidth || 960)
    update()
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = diffPaneEl
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const readViewportWidth = () => {
      const scroller = el.firstElementChild
      if (scroller instanceof HTMLElement && scroller.clientWidth > 0) {
        return scroller.clientWidth
      }
      return el.clientWidth || 720
    }
    setDiffPaneWidth(readViewportWidth())
    setDiffCharWidthPx(measureDiffCharWidthPx(el))
    const observer = new ResizeObserver(() => {
      const next = Math.round(readViewportWidth())
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setDiffPaneWidth(next)
        setDiffCharWidthPx(measureDiffCharWidthPx(el))
      }, 120)
    })
    observer.observe(el)
    if (el.firstElementChild instanceof HTMLElement) {
      observer.observe(el.firstElementChild)
    }
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect()
    }
  }, [diffPaneEl])

  const isTwoColumn = containerWidth >= TWO_COLUMN_BREAKPOINT_PX

  const isMocked = initialSessionData !== undefined || initialWorkspaceData !== undefined

  useEffect(() => {
    setSelectedRepoPath(null)
  }, [sessionCwd])

  const workspaceTarget = selectedRepoPath || sessionCwd

  const loadData = useCallback(async () => {
    if (isMocked || !sessionCwd) return
    setLoading(true)
    setError(null)
    try {
      const [wsRes, sessRes] = await Promise.all([
        typeof window.app?.getReviewWorkspace === 'function'
          ? window.app.getReviewWorkspace(workspaceTarget, {
              mode: workspaceMode,
              commitSha: selectedCommitSha ?? undefined,
            })
          : Promise.resolve(null),
        sessionId && typeof window.app?.getReviewSession === 'function'
          ? window.app.getReviewSession(sessionId, sessionCwd, sessionMessages)
          : Promise.resolve(null),
      ])
      if (wsRes) setWorkspaceData(wsRes)
      if (sessRes) {
        setSessionData(sessRes)
        setSelectedTurnIndex((prev) => {
          if (sessRes.turns.length === 0) return null
          if (prev !== null && sessRes.turns.some((turn) => turn.turnIndex === prev)) return prev
          return sessRes.turns[sessRes.turns.length - 1].turnIndex
        })
      }
    } catch (err) {
      setError((err as Error).message || t('review.error.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [isMocked, sessionCwd, workspaceTarget, workspaceMode, selectedCommitSha, sessionId, sessionMessages, t])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (isMocked) return
    if (prevStatusRef.current === 'streaming' && sessionStatus !== 'streaming') {
      void loadData()
    }
    prevStatusRef.current = sessionStatus
  }, [sessionStatus, loadData, isMocked])

  useEffect(() => {
    if (isMocked || !sessionCwd) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void loadData() }, 350)
    }
    const unsubFile = window.app?.onFileChangeEvent?.(schedule)
    const unsubGit = window.app?.onGitHeadChange?.(schedule)
    return () => {
      if (timer) clearTimeout(timer)
      unsubFile?.()
      unsubGit?.()
    }
  }, [isMocked, sessionCwd, loadData])

  const activeTurn = useMemo(() => {
    if (!sessionData || sessionData.turns.length === 0) return null
    return sessionData.turns.find((turn) => turn.turnIndex === selectedTurnIndex)
      ?? sessionData.turns[sessionData.turns.length - 1]
  }, [sessionData, selectedTurnIndex])

  const activeFiles = useMemo<ReviewFileDiff[]>(() => {
    if (scope === 'workspace') return workspaceData?.files ?? []
    if (scope === 'session') return sessionData?.sessionFiles ?? []
    return activeTurn?.files ?? []
  }, [scope, workspaceData, sessionData, activeTurn])

  const lineNumberDigits = useMemo(
    () => maxLineNumberDigitsForFiles(activeFiles),
    [activeFiles],
  )
  const effectiveDiffStyle: 'split' | 'unified' = diffPref === 'auto'
    ? resolveAutoDiffStyle(diffPaneWidth, diffCharWidthPx, lineNumberDigits)
    : diffPref

  const activeTotals = useMemo(() => {
    if (scope === 'workspace') {
      return {
        additions: workspaceData?.totalAdditions ?? 0,
        deletions: workspaceData?.totalDeletions ?? 0,
      }
    }
    if (scope === 'session') {
      return {
        additions: sessionData?.sessionAdditions ?? 0,
        deletions: sessionData?.sessionDeletions ?? 0,
      }
    }
    return {
      additions: activeTurn?.totalAdditions ?? 0,
      deletions: activeTurn?.totalDeletions ?? 0,
    }
  }, [scope, workspaceData, sessionData, activeTurn])

  const scopeCollapseKey = `${scope}:${workspaceMode}:${selectedCommitSha ?? ''}:${workspaceTarget}:${activeTurn?.turnIndex ?? ''}`

  useEffect(() => {
    if (activeFiles.length === 0) {
      setSelectedFilePath(null)
      return
    }
    if (initializedScopeKeyRef.current !== scopeCollapseKey) {
      initializedScopeKeyRef.current = scopeCollapseKey
      setCollapsedFiles(new Set(activeFiles.slice(1).map((f) => f.path)))
    }
    setSelectedFilePath((prev) =>
      prev && activeFiles.some((f) => f.path === prev) ? prev : activeFiles[0].path,
    )
  }, [activeFiles, scopeCollapseKey])

  const allCollapsed = activeFiles.length > 0 && activeFiles.every((f) => collapsedFiles.has(f.path))

  const handleToggleCollapseAll = useCallback(() => {
    setCollapsedFiles((prev) => {
      if (activeFiles.length > 0 && activeFiles.every((f) => prev.has(f.path))) {
        return new Set()
      }
      return new Set(activeFiles.map((f) => f.path))
    })
  }, [activeFiles])

  const handleToggleFileCollapse = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }, [])

  const handleSelectFileFromTree = useCallback((filePath: string) => {
    setSelectedFilePath(filePath)
    setCollapsedFiles((prev) => {
      if (!prev.has(filePath)) return prev
      const next = new Set(prev)
      next.delete(filePath)
      return next
    })
    requestAnimationFrame(() => {
      fileRowRefs.current.get(filePath)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const effectiveRoot = scope === 'workspace'
    ? (workspaceData?.root || sessionCwd)
    : (sessionData?.cwd || sessionCwd)

  const activeFilePaths = useMemo(
    () => activeFiles.map((file) => file.path),
    [activeFiles],
  )

  const commentCounts = useMemo(
    () => countCommentsByFile(replyComments, activeFiles, effectiveRoot),
    [replyComments, activeFiles, effectiveRoot],
  )

  const isLatestTurn = scope === 'turn'
    && activeTurn !== null
    && sessionData !== null
    && activeTurn.turnIndex === sessionData.turns[sessionData.turns.length - 1]?.turnIndex
  const lspAllowed = (scope === 'workspace' && (workspaceMode === 'uncommitted' || workspaceMode === 'unstaged'))
    || scope === 'session'
    || isLatestTurn

  const showConcurrentBadge = (scope === 'turn' && activeTurn?.concurrent)
    || (scope === 'session' && sessionData?.hasConcurrentTurns)
  const showToolFallbackBadge = (scope === 'turn' && activeTurn?.source === 'tool-fallback')
    || (scope === 'session' && sessionData?.sessionSource === 'tool-fallback')

  const emptyMessage = useMemo(() => {
    if (scope === 'workspace') {
      return workspaceData && !workspaceData.isRepo
        ? t('review.empty.notRepo')
        : t('review.empty.workspace')
    }
    if (scope === 'session') return t('review.empty.session')
    if (!sessionData || sessionData.turns.length === 0) return t('review.empty.noTurns')
    return t('review.empty.turn')
  }, [scope, workspaceData, sessionData, t])

  return (
    <div
      ref={containerRef}
      data-testid="review-panel"
      data-layout-columns={isTwoColumn ? '2' : '1'}
      data-diff-style={effectiveDiffStyle}
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      <ReviewToolbar
        scope={scope}
        onScopeChange={setScope}
        workspaceMode={workspaceMode}
        selectedCommitSha={selectedCommitSha}
        onSelectWorkspaceMode={(mode, commitSha) => {
          setWorkspaceMode(mode)
          setSelectedCommitSha(commitSha ?? null)
        }}
        repos={workspaceData?.repos ?? []}
        selectedRepoPath={selectedRepoPath}
        currentBranch={workspaceData?.currentBranch ?? null}
        baseBranch={workspaceData?.baseBranch ?? null}
        recentCommits={workspaceData?.recentCommits ?? []}
        onSelectRepo={(repoPath) => {
          setSelectedRepoPath(repoPath)
          setScope('workspace')
        }}
        hasFiles={activeFiles.length > 0}
        sidebarVisible={fileTreeOpen}
        onToggleSidebar={() => setFileTreeOpen((v) => !v)}
        turns={sessionData?.turns ?? []}
        selectedTurnIndex={activeTurn?.turnIndex ?? null}
        onSelectTurn={setSelectedTurnIndex}
        fileCount={activeFiles.length}
        additions={activeTotals.additions}
        deletions={activeTotals.deletions}
        showConcurrentBadge={Boolean(showConcurrentBadge)}
        showToolFallbackBadge={Boolean(showToolFallbackBadge)}
        diffPref={diffPref}
        onDiffPrefChange={setDiffPref}
        allCollapsed={allCollapsed}
        onToggleCollapseAll={handleToggleCollapseAll}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((v) => !v)}
        richPreview={richPreview}
        onToggleRichPreview={() => setRichPreview((v) => !v)}
        loading={loading}
        onRefresh={() => { void loadData() }}
        lspWorkspaceRoot={effectiveRoot}
        lspFilePaths={activeFilePaths}
        lspAllowed={lspAllowed}
      />

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-xs text-muted-foreground">
          <AlertTriangle className="size-5 text-destructive" />
          <p>{error}</p>
          <Button size="xs" variant="outline" onClick={() => { void loadData() }}>
            {t('review.error.retry')}
          </Button>
        </div>
      ) : loading && activeFiles.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          <span>{t('review.title')}…</span>
        </div>
      ) : activeFiles.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
          <FileDiffIcon className="size-6 opacity-40" />
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {isTwoColumn && fileTreeOpen && (
              <motion.div
                key="wide-file-tree"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="h-full max-w-[42%] shrink-0 overflow-hidden"
              >
                <ReviewFileSidebar
                  files={activeFiles}
                  selectedPath={selectedFilePath}
                  commentCounts={commentCounts}
                  onSelect={handleSelectFileFromTree}
                  className="w-80 max-w-full"
                />
              </motion.div>
            )}

            {!isTwoColumn && fileTreeOpen && (
              <motion.div
                key="narrow-file-tree"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute inset-y-0 left-0 z-20 w-80 max-w-[85vw] shadow-lg"
              >
                <ReviewFileSidebar
                  files={activeFiles}
                  selectedPath={selectedFilePath}
                  commentCounts={commentCounts}
                  onSelect={(path) => {
                    handleSelectFileFromTree(path)
                    setFileTreeOpen(false)
                  }}
                  className="bg-popover"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={handleDiffPaneRef} className="min-w-0 flex-1 overflow-hidden">
            {(() => {
              const list = (
                <Virtualizer style={VIRTUALIZER_STYLE}>
                  {activeFiles.map((file) => (
                    <div
                      key={file.path}
                      ref={(el) => {
                        if (el) fileRowRefs.current.set(file.path, el)
                        else fileRowRefs.current.delete(file.path)
                      }}
                    >
                      <ReviewDiffCanvas
                        file={file}
                        scope={scope}
                        workspaceRoot={effectiveRoot}
                        diffStyle={effectiveDiffStyle}
                        wordWrap={wordWrap}
                        richPreview={richPreview}
                        maxPathChars={Math.max(24, Math.floor((diffPaneWidth - 180) / 7.5))}
                        collapsed={collapsedFiles.has(file.path)}
                        lazyViewport
                        scrollRootRef={diffPaneRef}
                        onToggleCollapse={() => handleToggleFileCollapse(file.path)}
                        lspAllowed={lspAllowed}
                      />
                    </div>
                  ))}
                </Virtualizer>
              )
              if (typeof Worker === 'undefined') return list
              return (
                <WorkerPoolContextProvider
                  poolOptions={WORKER_POOL_OPTIONS}
                  highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
                >
                  {list}
                </WorkerPoolContextProvider>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

export default ReviewPanel
