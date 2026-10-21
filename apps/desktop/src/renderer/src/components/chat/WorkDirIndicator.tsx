import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { GitBranch, ChevronDown, Check, Monitor, Server, GitCommit, Circle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useOnTurnCompleted } from '@/hooks/useOnTurnCompleted'
import type { GitDirtyStatus, GitInfoResult, WorktreeEntry, WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { WorkDirLabel, workDirIcon, workDirTitle, type WorkDirState } from './work-dir-label'
import { WorktreeHandoffSection } from './WorktreeHandoffSection'
import { WorktreeAssignBranchSection } from './WorktreeAssignBranchSection'
import { WorktreeForkSection } from './WorktreeForkSection'
import { WorktreeEntryRow } from './WorktreeEntryRow'
import { DiffStat, sameDirty } from './DiffStat'
import {
  patchFocusedCreate,
  switchComposerToCheckout,
  useComposerLocation,
  writeFocusedSelection,
} from './composer-location'
import { EnvironmentKindIcon } from '@/components/sidebar/multi-host/EnvironmentSectionHeader'
import { WorkDirEnvironmentMenu } from './WorkDirEnvironmentMenu'
import {
  checkoutOnEnvironment,
  cloneAndOpenCheckout,
  projectDirectoryName,
  useWorkDirEnvironmentMenu,
  type WorkDirEnvironmentOption,
} from './work-dir-environment'
import { selectionForNewSession } from '@superone/shared/session-location'
import { EMPTY_BRANCH_LISTS, readBranchLists, type GitBranchLists } from './git-branch-lists'

/** Match host path to UI activePath (may be remote:<conn>:<hostPath>). */
function sameWorktreePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const ra = parseRemoteProjectKey(a)
  const rb = parseRemoteProjectKey(b)
  if (ra && rb) {
    return ra.connectionId === rb.connectionId && ra.path.replace(/\/$/, '') === rb.path.replace(/\/$/, '')
  }
  if (ra) return ra.path.replace(/\/$/, '') === b.replace(/\/$/, '')
  if (rb) return a.replace(/\/$/, '') === rb.path.replace(/\/$/, '')
  return a.replace(/\/$/, '') === b.replace(/\/$/, '')
}

function displayHostPath(path: string | null | undefined): string {
  if (!path) return ''
  return parseRemoteProjectKey(path)?.path ?? path
}

interface WorkDirIndicatorProps {
  compact?: boolean
  isGitRepo?: boolean | null
}

interface WtMeta {
  dirty?: GitDirtyStatus
  shortHead: string
  baseBranch?: string | null
  isDetached: boolean
}

const CLEAN: GitDirtyStatus = { files: 0, insertions: 0, deletions: 0 }

/**
 * GIT_INFO omits `dirty` for a clean checkout, but this popover distinguishes
 * "known clean" (renders `clean` / the grey dot) from "unknown" (blank line):
 * a successful read with no changes is clean; a failed read stays undefined.
 */
const knownDirty = (info: GitInfoResult | null | undefined): GitDirtyStatus | undefined =>
  info && info.branch !== null ? (info.dirty ?? CLEAN) : undefined

export function WorkDirIndicator({ compact = false, isGitRepo }: WorkDirIndicatorProps) {
  const { t } = useTranslation()
  const scope = useSessionScope()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const location = useComposerLocation()
  const isOldSession = location.readOnly
  const environmentMenu = useWorkDirEnvironmentMenu(currentFolder, isGitRepo)
  const environmentBucket = environmentMenu.buckets.find((bucket) =>
    bucket.environmentId === location.environmentId || bucket.connectionId === location.environmentId)
  const environmentPrefix = environmentBucket?.label
    ? { label: environmentBucket.label, kind: environmentBucket.kind }
    : null
  const renderChip = (body: ReactNode) => (
    <span className="flex max-w-72 items-center gap-1 truncate">
      {environmentPrefix && (
        <>
          <EnvironmentKindIcon kind={environmentPrefix.kind} className="size-3 shrink-0" />
          <span className="truncate">{environmentPrefix.label}</span>
          <span className="text-muted-foreground">·</span>
        </>
      )}
      {body}
    </span>
  )
  const withEnvironment = (title: string) => (environmentPrefix ? `${environmentPrefix.label} · ${title}` : title)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const activeGitBranch = useActiveSession((s) => s._gitBranch)
  const activeSessionId = useActiveSession((s) => scope?.sessionId ?? s._activeSessionId)

  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [branchLists, setBranchLists] = useState<GitBranchLists>(EMPTY_BRANCH_LISTS)
  const [fetchingBranches, setFetchingBranches] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [mainDirty, setMainDirty] = useState<GitDirtyStatus | undefined>()
  const [wtMetas, setWtMetas] = useState<Record<string, WtMeta>>({})
  const [checkedOutBranches, setCheckedOutBranches] = useState<Set<string>>(new Set())
  const [activeDirty, setActiveDirty] = useState<GitDirtyStatus | undefined>()

  const activePath = location.selection.kind === 'existing' ? location.selection.path : null
  /** Remote node project: same “Local” label, Server icon (vs Monitor on this machine). */
  const isRemoteProject = Boolean(currentFolder && parseRemoteProjectKey(currentFolder))
  const mainCheckoutState: WorkDirState = {
    kind: 'local',
    host: isRemoteProject ? 'remote' : 'machine',
  }
  const MainCheckoutIcon = isRemoteProject ? Server : Monitor
  const mainCheckoutLabel = t('tooltips.local')

  const refreshWorktreeInfo = useCallback(() => {
    if (!currentFolder || isGitRepo === false) return
    window.app.getWorktreeInfo(currentFolder).then(setWorktreeInfo).catch(() => {})
  }, [currentFolder, isGitRepo])

  // A freshly forked worktree must land in `entries` for `activeEntry` to
  // resolve and render the detached icon — so activePath is a dependency.
  useEffect(() => {
    if (!currentFolder || isGitRepo === false) { setWorktreeInfo(null); return }
    let cancelled = false
    window.app.getWorktreeInfo(currentFolder).then((info) => {
      if (!cancelled) setWorktreeInfo(info)
    })
    return () => { cancelled = true }
  }, [currentFolder, isGitRepo, activePath])

  const refreshActiveDirty = useCallback(() => {
    if (!activePath) return
    window.app.getGitInfo(activePath).then((info) => {
      const next = knownDirty(info)
      setActiveDirty((prev) => (sameDirty(prev, next) ? prev : next))
    }).catch(() => {})
  }, [activePath])

  // The agent can also move the worktree's HEAD or attach a branch to a
  // detached checkout during a turn (`git switch -c` / `git checkout -b`), and
  // the file-watcher only covers the main checkout — so the entry list that
  // decides "detached vs branch" must be re-read at the same boundary as dirty.
  const refreshActiveWorktree = useCallback(() => {
    if (!activePath) return
    refreshActiveDirty()
    refreshWorktreeInfo()
  }, [activePath, refreshActiveDirty, refreshWorktreeInfo])

  // Event-driven, like the branch chip: read once for the worktree, then only
  // when a turn ends or the repo's HEAD moves.
  useEffect(() => {
    if (!activePath) { setActiveDirty(undefined); return }
    let cancelled = false
    window.app.getGitInfo(activePath).then((info) => {
      if (cancelled) return
      const next = knownDirty(info)
      setActiveDirty((prev) => (sameDirty(prev, next) ? prev : next))
    }).catch(() => {})
    const unsub = window.app.onGitHeadChange((evt) => {
      if (evt.folderPath === activePath) refreshActiveWorktree()
    })
    return () => { cancelled = true; unsub() }
  }, [activePath, refreshActiveWorktree])

  useOnTurnCompleted(refreshActiveWorktree)

  const loadPopoverData = useCallback(async () => {
    if (!currentFolder) return
    const [info, br, gitInfo, checkedOut] = await Promise.all([
      window.app.getWorktreeInfo(currentFolder),
      window.app.getGitBranches(currentFolder),
      window.app.getGitInfo(currentFolder),
      window.app.getCheckedOutBranches(currentFolder),
    ])
    setWorktreeInfo(info)
    setBranchLists(readBranchLists(br))
    setMainDirty(gitInfo?.dirty)
    setCheckedOutBranches(new Set(checkedOut))

    if (info?.entries?.length) {
      const nonMain = info.entries.filter((e) => !e.isMain)
      const metas: Record<string, WtMeta> = {}
      const remote = currentFolder ? parseRemoteProjectKey(currentFolder) : null
      // Remote: do NOT getGitInfo(worktree host path) — that used to openProject each
      // worktree path and leave ghost rows in project.list / ChatSuggestions.
      if (remote) {
        for (const e of nonMain) {
          metas[e.path] = {
            dirty: undefined,
            shortHead: e.head ? e.head.slice(0, 7) : '',
            isDetached: !e.branch,
          }
        }
      } else {
        await Promise.all(nonMain.map(async (e) => {
          const wtInfo = await window.app.getGitInfo(e.path).catch(() => null)
          metas[e.path] = {
            dirty: knownDirty(wtInfo),
            shortHead: e.head ? e.head.slice(0, 7) : '',
            isDetached: !e.branch,
          }
        }))
      }
      setWtMetas(metas)
    } else {
      setWtMetas({})
    }
  }, [currentFolder])

  const openPopover = useCallback((open: boolean) => {
    if (!open && currentFolder && location.selection.kind === 'create'
      && location.selection.mode === 'branch' && !location.selection.branchName.trim()) {
      useAppStore.getState().clearPendingWorktree(currentFolder)
      writeFocusedSelection(currentFolder, selectionForNewSession(location.environmentId), {
        cwd: currentFolder,
        worktreePath: null,
        gitBranch: null,
      })
    }
    setPopoverOpen(open)
    if (open) {
      setSearch('')
      void loadPopoverData()
    }
  }, [loadPopoverData, currentFolder, location.selection, location.environmentId])

  const handleSelectEnvironment = useCallback((option: WorkDirEnvironmentOption) => {
    const checkout = checkoutOnEnvironment(environmentMenu.buckets, option.environmentId, environmentMenu.repoIdentity)
    if (!checkout) return
    setPopoverOpen(false)
    void switchComposerToCheckout({
      pathKey: checkout.pathKey,
      connectionId: checkout.connectionId,
      projectId: checkout.projectId,
      environmentId: checkout.environmentId,
    })
  }, [environmentMenu.buckets, environmentMenu.repoIdentity])

  const handleCloneEnvironment = useCallback((option: WorkDirEnvironmentOption) => {
    if (!environmentMenu.repoIdentity) return
    setEnvironmentError(null)
    void cloneAndOpenCheckout({
      connectionId: option.connectionId,
      environmentId: option.environmentId,
      repoIdentity: environmentMenu.repoIdentity,
      directoryName: projectDirectoryName(currentFolder),
    }).catch((err: unknown) => {
      setEnvironmentError(err instanceof Error ? err.message : String(err))
    })
  }, [currentFolder, environmentMenu.repoIdentity])

  const handleSelectBase = useCallback((baseBranch: string) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingWorktree(currentFolder, baseBranch)
    patchFocusedCreate(currentFolder, {
      baseBranch,
      mode: 'branch',
      branchName: '',
      carryLocalChanges: false,
    })
  }, [currentFolder])

  const handleSwitchToLocal = useCallback(() => {
    if (!currentFolder) return
    setPopoverOpen(false)
    writeFocusedSelection(currentFolder, selectionForNewSession(location.environmentId), {
      cwd: currentFolder,
      worktreePath: null,
      gitBranch: null,
    })
    void useAppStore.getState().clearWorktree(currentFolder)
  }, [currentFolder, location.environmentId])

  const handleSwitchToExisting = useCallback((entry: WorktreeEntry) => {
    if (!currentFolder) return
    setPopoverOpen(false)
    const environmentId = location.environmentId
    writeFocusedSelection(currentFolder, {
      environmentId,
      selection: { kind: 'existing', path: entry.path, ...(entry.branch ? { branch: entry.branch } : {}) },
    }, {
      cwd: entry.path,
      worktreePath: entry.path,
      gitBranch: entry.branch || null,
    })
    void useAppStore.getState().switchToExistingWorktree(currentFolder, entry.path, entry.branch || null)
  }, [currentFolder, location.environmentId])

  const handleSetMode = useCallback((mode: WorktreeMode) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingMode(currentFolder, mode)
    patchFocusedCreate(currentFolder, { mode })
  }, [currentFolder])

  const handleSetBranchName = useCallback((name: string) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingBranchName(currentFolder, name)
    patchFocusedCreate(currentFolder, { branchName: name })
  }, [currentFolder])

  const handleToggleCarry = useCallback(() => {
    if (!currentFolder || location.selection.kind !== 'create') return
    const next = !location.selection.carryLocalChanges
    useAppStore.getState().setPendingCarryLocalChanges(currentFolder, next)
    patchFocusedCreate(currentFolder, { carryLocalChanges: next })
  }, [currentFolder, location.selection])

  const createMode = location.selection.kind === 'create' ? location.selection.mode : null
  const createBase = location.selection.kind === 'create' ? location.selection.baseBranch : null
  const createCarry = location.selection.kind === 'create' && location.selection.carryLocalChanges

  useEffect(() => {
    if (!currentFolder || createMode !== 'attach' || !createBase) return
    if (!worktreeInfo) return
    if (!checkedOutBranches.has(createBase)) return
    useAppStore.getState().setPendingMode(currentFolder, 'branch')
    patchFocusedCreate(currentFolder, { mode: 'branch' })
  }, [currentFolder, createMode, createBase, worktreeInfo, checkedOutBranches])

  useEffect(() => {
    if (!currentFolder || !createCarry) return
    if (mainDirty && mainDirty.files > 0) return
    useAppStore.getState().setPendingCarryLocalChanges(currentFolder, false)
    patchFocusedCreate(currentFolder, { carryLocalChanges: false })
  }, [currentFolder, createCarry, mainDirty])

  const existingEntries = useMemo(() => {
    if (!worktreeInfo) return []
    return worktreeInfo.entries.filter((e) => !e.isMain)
  }, [worktreeInfo])

  const lowerSearch = search.trim().toLowerCase()
  const filteredExisting = useMemo(() => {
    if (!lowerSearch) return existingEntries
    return existingEntries.filter((e) => {
      const meta = wtMetas[e.path]
      const hay = [e.branch, meta?.shortHead, e.path].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(lowerSearch)
    })
  }, [existingEntries, wtMetas, lowerSearch])

  const filteredBranches = useMemo(() => {
    if (!lowerSearch) return branchLists.local
    return branchLists.local.filter((b) => b.toLowerCase().includes(lowerSearch))
  }, [branchLists.local, lowerSearch])

  const filteredTracking = useMemo(() => {
    if (!lowerSearch) return branchLists.tracking
    return branchLists.tracking.filter((ref) => ref.toLowerCase().includes(lowerSearch))
  }, [branchLists.tracking, lowerSearch])

  const handleFetch = useCallback(async () => {
    if (!currentFolder || fetchingBranches) return
    setFetchingBranches(true)
    setFetchError(null)
    try {
      const result = await window.app.gitFetch(currentFolder)
      if (!result.ok) {
        setFetchError(result.error || 'git fetch failed')
        return
      }
      const lists = await window.app.getGitBranches(currentFolder).catch(() => EMPTY_BRANCH_LISTS)
      setBranchLists(readBranchLists(lists))
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'git fetch failed')
    } finally {
      setFetchingBranches(false)
    }
  }, [currentFolder, fetchingBranches])

  if (isGitRepo === false) {
    if (!environmentMenu.visible) {
      return (
        <div className="flex items-center gap-1 rounded-lg px-2 py-1" title={withEnvironment(mainCheckoutLabel)}>
          {compact ? (
            <MainCheckoutIcon className="size-3" />
          ) : (
            renderChip(
              <>
                <MainCheckoutIcon className="inline size-3 shrink-0 align-middle" />
                <span className="truncate">{mainCheckoutLabel}</span>
              </>,
            )
          )}
        </div>
      )
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-muted" title={withEnvironment(mainCheckoutLabel)}>
            {compact ? (
              <MainCheckoutIcon className="size-3" />
            ) : (
              renderChip(
                <>
                  <MainCheckoutIcon className="inline size-3 shrink-0 align-middle" />
                  <span className="truncate">{mainCheckoutLabel}</span>
                </>,
              )
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <WorkDirEnvironmentMenu
            visible
            error={environmentError}
            readOnly={isOldSession}
            options={environmentMenu.options}
            selectedId={location.environmentId}
            onSelect={handleSelectEnvironment}
            onClone={handleCloneEnvironment}
          />
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('chat.worktree.notAGitRepo')}</p>
        </PopoverContent>
      </Popover>
    )
  }

  // Don't hide the chip while worktree RPC is in flight — show Local optimistically.
  // Remote getWorktreeInfo was blocking the whole status-bar host icon for seconds.
  // The environment menu still has to open before that RPC returns.
  if (!worktreeInfo) {
    const triggerClass = 'flex items-center gap-1 rounded-lg px-2 py-1'
    const label = compact ? (
      <MainCheckoutIcon className="size-3" />
    ) : (
      renderChip(
        <>
          <MainCheckoutIcon className="inline size-3 shrink-0 align-middle" />
          <span className="truncate">{mainCheckoutLabel}</span>
        </>,
      )
    )
    if (!environmentMenu.visible) {
      return (
        <div className={triggerClass} title={withEnvironment(mainCheckoutLabel)}>
          {label}
        </div>
      )
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={`${triggerClass} hover:bg-muted`} title={withEnvironment(mainCheckoutLabel)}>
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <WorkDirEnvironmentMenu
            visible
            loading={environmentMenu.loading}
            error={environmentError}
            readOnly={isOldSession}
            options={environmentMenu.options}
            selectedId={location.environmentId}
            onSelect={handleSelectEnvironment}
            onClone={handleCloneEnvironment}
          />
        </PopoverContent>
      </Popover>
    )
  }

  const pending = location.selection.kind === 'create' ? location.selection : null
  const isPending = !!pending
  const isActive = location.selection.kind === 'existing'
  const isInWorktree = isPending || isActive

  const activeEntry = isActive
    ? existingEntries.find((e) => sameWorktreePath(e.path, activePath))
    : undefined
  const activeIsDetached = activeEntry ? !activeEntry.branch : false
  const activeShortHead = activeEntry?.head ? activeEntry.head.slice(0, 7) : ''

  const pendingMode = pending?.mode ?? 'branch'
  const pendingBranchName = pending?.branchName ?? ''
  const pendingBase = pending?.baseBranch ?? ''
  const pendingCarry = pending?.carryLocalChanges ?? false

  const branchExists = pendingMode === 'branch' && pendingBranchName.trim().length > 0 && branchLists.local.includes(pendingBranchName.trim())

  const attachUnavailableReason = (b: string): string | null => {
    if (!worktreeInfo) return null
    if (!checkedOutBranches.has(b)) return null
    const mainEntry = worktreeInfo.entries.find((e) => e.isMain)
    if (mainEntry && mainEntry.branch === b) return t('chat.worktree.attachUnavailableMain')
    return t('chat.worktree.attachUnavailableOther')
  }

  const workDirState: WorkDirState = isActive
    ? (activeIsDetached
        ? { kind: 'activeDetached', hash: activeShortHead }
        : { kind: 'activeBranch', name: activeEntry?.branch ?? activeGitBranch ?? '' })
    : isPending
      ? (pendingMode === 'detach'
          ? { kind: 'createFrom', base: pendingBase }
          : pendingMode === 'attach'
            ? { kind: 'attachTo', base: pendingBase }
            : { kind: 'createBranch', name: pendingBranchName })
      : mainCheckoutState
  const CompactIcon = workDirIcon(workDirState)
  const titleText = workDirTitle(workDirState, t)
  const renderFullLabel = () => <WorkDirLabel state={workDirState} />

  const headingText = !isPending
    ? t('chat.worktree.createFromHeading')
    : pendingMode === 'attach'
      ? t('chat.worktree.attachToHeading')
      : pendingMode === 'detach'
        ? t('chat.worktree.detachAtHeading')
        : t('chat.worktree.createFromHeading')

  const showDirty = isActive && !!activeDirty
  const dirtyDot = showDirty ? (
    <Circle className={`size-1.5 ${activeDirty!.files > 0 ? 'fill-amber-500 text-amber-500' : 'fill-muted-foreground/40 text-muted-foreground/40'}`} />
  ) : null

  if (isOldSession) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
            title={withEnvironment(titleText)}
          >
            {compact ? (
              <CompactIcon className="size-3" />
            ) : (
              renderChip(renderFullLabel())
            )}
            {dirtyDot}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <WorkDirEnvironmentMenu
            visible={environmentMenu.visible}
            loading={environmentMenu.loading}
            error={environmentError}
            readOnly
            options={environmentMenu.options}
            selectedId={location.environmentId}
            onSelect={handleSelectEnvironment}
            onClone={handleCloneEnvironment}
          />
          <div className="flex items-center gap-2 px-3 py-2 text-xs">
            {!isActive ? (
              <MainCheckoutIcon className="size-3 shrink-0 text-muted-foreground" />
            ) : activeIsDetached ? (
              <GitCommit className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <GitBranch className="size-3 shrink-0 text-muted-foreground" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">
                {!isActive
                  ? mainCheckoutLabel
                  : activeIsDetached
                    ? activeShortHead
                    : (activeEntry?.branch ?? activeGitBranch ?? '')}
              </span>
              {activeDirty && (
                <span className="text-xs text-muted-foreground">
                  {activeDirty.files > 0 ? (
                    <>uncommitted: <DiffStat stat={activeDirty} /></>
                  ) : (
                    'clean'
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="border-t px-3 py-2 text-xs">
            <div className="text-muted-foreground">{isActive ? t('sidebar.hover.worktree') : t('sidebar.hover.checkout')}</div>
            <div className="truncate font-mono">{displayHostPath(isActive ? activePath : currentFolder)}</div>
          </div>

          {isActive && activePath && activeIsDetached && currentFolder && (
            <WorktreeAssignBranchSection
              folderPath={currentFolder}
              worktreePath={activePath}
              onAssigned={() => {
                void window.app.getWorktreeInfo(currentFolder).then(setWorktreeInfo)
                setPopoverOpen(false)
              }}
            />
          )}

          {isActive && activePath && (
            <WorktreeHandoffSection
              worktreePath={activePath}
              folderPath={currentFolder ?? undefined}
              dirty={activeDirty}
              onDone={() => setPopoverOpen(false)}
            />
          )}

          {!isActive && activeSessionId && currentFolder && (
            <WorktreeForkSection
              sessionId={activeSessionId}
              cwd={currentFolder}
              onForked={() => setPopoverOpen(false)}
            />
          )}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover open={popoverOpen} onOpenChange={openPopover}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
          title={withEnvironment(titleText)}
        >
          {compact ? (
            <CompactIcon className="size-3" />
          ) : (
            renderChip(renderFullLabel())
          )}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <WorkDirEnvironmentMenu
          visible={environmentMenu.visible}
          loading={environmentMenu.loading}
          error={environmentError}
          readOnly={false}
          options={environmentMenu.options}
          selectedId={location.environmentId}
          onSelect={handleSelectEnvironment}
          onClone={handleCloneEnvironment}
        />
        <div className="flex flex-col">
          <div className="border-b px-3 py-2">
            <input
              type="text"
              className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              placeholder={t('chat.worktree.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">{t('chat.worktree.checkoutHeading')}</div>
            <button
              type="button"
              onClick={isInWorktree ? handleSwitchToLocal : undefined}
              disabled={!isInWorktree}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            >
              <MainCheckoutIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{mainCheckoutLabel}</span>
              {!isInWorktree && <Check className="size-3 shrink-0 text-primary" />}
            </button>

            {filteredExisting.length > 0 && (
              <>
                <div className="border-t" />
                <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">{t('chat.worktree.existingHeading')}</div>
                {filteredExisting.map((e) => {
                  const meta = wtMetas[e.path]
                  const detached = !e.branch
                  return (
                    <WorktreeEntryRow
                      key={e.path}
                      label={detached ? `${t('chat.worktree.detachedLabel')} ${meta?.shortHead ?? ''}` : e.branch!}
                      detached={detached}
                      dirty={meta?.dirty}
                      isCurrent={sameWorktreePath(e.path, activePath)}
                      onClick={() => handleSwitchToExisting(e)}
                    />
                  )
                })}
              </>
            )}

            <div className="border-t" />
            <div className="flex items-center gap-2 px-3 pt-2">
              <span className="min-w-0 flex-1 text-xs uppercase text-muted-foreground">{headingText}</span>
              <button
                type="button"
                disabled={fetchingBranches}
                onClick={() => { void handleFetch() }}
                className="shrink-0 rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                {fetchingBranches ? t('chat.git.fetching') : t('chat.git.fetch')}
              </button>
            </div>
            {fetchError && (
              <div className="truncate px-3 py-1 text-xs text-destructive" title={fetchError}>
                {t('chat.git.fetchFailed', { error: fetchError })}
              </div>
            )}
            {filteredBranches.map((b) => {
              const reason = pendingMode === 'attach' ? attachUnavailableReason(b) : null
              const disabled = pendingMode === 'attach' && !!reason
              const isSelected = pendingBase === b
              return (
                <button
                  key={b}
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && handleSelectBase(b)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <div className="flex flex-1 flex-col items-start min-w-0">
                    <span className="truncate">{b}</span>
                    {reason && <span className="truncate text-xs text-muted-foreground">{reason}</span>}
                  </div>
                  {isSelected && <Check className="mt-0.5 size-3 shrink-0 text-primary" />}
                </button>
              )
            })}
            {filteredTracking.map((ref) => {
              const isSelected = pendingBase === ref
              return (
                <button
                  key={ref}
                  type="button"
                  onClick={() => handleSelectBase(ref)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                >
                  <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{ref}</span>
                  <span className="shrink-0 text-muted-foreground">{t('chat.git.remoteRef')}</span>
                  {isSelected && <Check className="mt-0.5 size-3 shrink-0 text-primary" />}
                </button>
              )
            })}

            {filteredExisting.length === 0 && filteredBranches.length === 0 && filteredTracking.length === 0 && search.trim().length > 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">{t('chat.worktree.noMatches')}</div>
            )}
          </div>

          {isPending && (
            <div className="border-t p-3">
              <div className="mb-2 text-xs text-muted-foreground">
                {t('chat.worktree.baseBranchLabel')}: <span className="font-mono text-foreground">{pendingBase}</span>
              </div>
              <div className="mb-3 flex gap-1 rounded-md bg-muted p-0.5">
                <ModeButton active={pendingMode === 'branch'} onClick={() => handleSetMode('branch')}>{t('chat.worktree.modeBranch')}</ModeButton>
                {!attachUnavailableReason(pendingBase) && (
                  <ModeButton active={pendingMode === 'attach'} onClick={() => handleSetMode('attach')}>{t('chat.worktree.modeAttach')}</ModeButton>
                )}
                <ModeButton active={pendingMode === 'detach'} onClick={() => handleSetMode('detach')}>{t('chat.worktree.modeDetach')}</ModeButton>
              </div>

              {pendingMode === 'branch' && (
                <>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('chat.worktree.branchNameLabel')}</label>
                  <input
                    type="text"
                    placeholder={t('chat.worktree.branchNamePlaceholder')}
                    value={pendingBranchName}
                    onChange={(e) => handleSetBranchName(e.target.value)}
                    className={`mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 ${branchExists ? 'border-red-500 focus:ring-red-500' : 'border-input focus:ring-ring'}`}
                  />
                  {branchExists && (
                    <div className="mb-3 flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
                      <span>{t('chat.worktree.branchExists', { name: pendingBranchName.trim() })}</span>
                      <button
                        type="button"
                        onClick={() => handleSetMode('attach')}
                        className="ml-2 rounded border border-current px-1.5 py-0.5 text-xs hover:bg-red-500/20"
                      >
                        {t('chat.worktree.switchToAttach')}
                      </button>
                    </div>
                  )}
                </>
              )}

              {pendingMode === 'attach' && (
                <div className="mb-3 rounded-md bg-muted px-2 py-2 text-xs text-muted-foreground">
                  {(() => {
                    const reason = attachUnavailableReason(pendingBase)
                    if (reason) return reason
                    return t('chat.worktree.attachInfo', { branch: pendingBase })
                  })()}
                </div>
              )}

              {pendingMode === 'detach' && (
                <div className="mb-3 rounded-md bg-muted px-2 py-2 text-xs text-muted-foreground">
                  {t('chat.worktree.detachInfo', {
                    branch: pendingBase,
                    hash: '...',
                  })}
                </div>
              )}

              {mainDirty && mainDirty.files > 0 && (
                <button
                  type="button"
                  onClick={handleToggleCarry}
                  className="flex w-full items-center gap-2 rounded-sm py-1 text-xs hover:bg-accent"
                >
                  <div className={`flex size-3.5 items-center justify-center rounded-sm border ${pendingCarry ? 'border-foreground bg-foreground' : 'border-muted-foreground'}`}>
                    {pendingCarry && <Check className="size-2.5 text-background" />}
                  </div>
                  <span>{t('chat.worktree.carryLocalChanges')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    <DiffStat stat={mainDirty} />
                  </span>
                </button>
              )}

              <div className="mt-2 text-xs text-muted-foreground">{t('chat.worktree.lazyHint')}</div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ModeButtonProps {
  active: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}

function ModeButton({ active, onClick, disabled, title, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed text-muted-foreground/40'
          : active
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
