import { useEffect, useState, useCallback, useMemo, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, GitFork, ChevronDown, Check, Folder, Circle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useOnTurnCompleted } from '@/hooks/useOnTurnCompleted'
import type { GitDirtyStatus, GitInfoResult, WorktreeEntry, WorktreeInfo } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { WorktreeHandoffSection } from './WorktreeHandoffSection'
import { WorktreeAssignBranchSection } from './WorktreeAssignBranchSection'
import { WorktreeForkSection } from './WorktreeForkSection'
import { WorktreeEntryRow } from './WorktreeEntryRow'
import { sameDirty } from './DiffStat'
import {
  patchFocusedCreate,
  switchComposerToCheckout,
  useComposerLocation,
  writeFocusedSelection,
} from './composer-location'
import { EnvironmentKindIcon } from '@/components/sidebar/multi-host/EnvironmentSectionHeader'
import type { EnvironmentKind } from '@/lib/multi-host/types'
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

/** Status-bar chip: environment kind and name, then the checkout or worktree label. */
function LocationChip({
  kind,
  environment,
  location,
  icon: Icon,
}: {
  kind: EnvironmentKind
  environment: string
  location: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <span className="flex max-w-72 items-center gap-1 truncate">
      <EnvironmentKindIcon kind={kind} className="size-3 shrink-0" />
      <span className="truncate">{environment}</span>
      <span className="text-muted-foreground">·</span>
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-muted-foreground">{location}</span>
    </span>
  )
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
  const isRemoteProject = Boolean(currentFolder && parseRemoteProjectKey(currentFolder))
  const fallbackEnvironment = typeof window !== 'undefined' && window.app.platform === 'darwin'
    ? t('sidebar.thisMac')
    : t('sidebar.thisPc')
  const environmentName = environmentBucket?.label || fallbackEnvironment
  const environmentKind: EnvironmentKind = environmentBucket?.kind ?? (isRemoteProject ? 'cli-node' : 'local')
  const localCheckoutLabel = t('chat.worktree.localCheckout')
  const chipTitle = (label: string) => `${environmentName} · ${label}`
  const localChip = compact
    ? <Folder className="size-3" />
    : <LocationChip kind={environmentKind} environment={environmentName} location={localCheckoutLabel} icon={Folder} />

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
    // The popover has no branch-name field. Detach creates the worktree from this
    // base without one; branch mode would fail on the next message.
    const carry = location.selection.kind === 'create' && location.selection.carryLocalChanges
    const store = useAppStore.getState()
    store.setPendingWorktree(currentFolder, baseBranch)
    store.setPendingMode(currentFolder, 'detach')
    if (carry) store.setPendingCarryLocalChanges(currentFolder, true)
    patchFocusedCreate(currentFolder, {
      baseBranch,
      mode: 'detach',
      branchName: '',
      carryLocalChanges: carry,
    })
  }, [currentFolder, location.selection])

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
    if (!currentFolder || !createCarry || !mainDirty) return
    if (mainDirty.files > 0) return
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
        <div className="flex items-center gap-1 rounded-lg px-2 py-1" title={chipTitle(localCheckoutLabel)}>
          {localChip}
        </div>
      )
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-muted" title={chipTitle(localCheckoutLabel)}>
            {localChip}
            {!compact && <ChevronDown className="size-3 text-muted-foreground" />}
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
          <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">{t('chat.worktree.checkoutHeading')}</div>
          <div className="flex w-full items-center gap-2 px-3 py-1.5 text-xs">
            <Folder className="size-3 shrink-0 text-muted-foreground" />
            <span className="shrink-0">{localCheckoutLabel}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{displayHostPath(currentFolder)}</span>
            <Check className="size-3 shrink-0 text-primary" />
          </div>
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('chat.worktree.notAGitRepo')}</p>
        </PopoverContent>
      </Popover>
    )
  }

  // Don't hide the chip while worktree RPC is in flight — show the checkout label
  // optimistically. Remote getWorktreeInfo was blocking the whole status-bar chip.
  // The environment menu still has to open before that RPC returns.
  if (!worktreeInfo) {
    const triggerClass = 'flex items-center gap-1 rounded-lg px-2 py-1'
    if (!environmentMenu.visible) {
      return (
        <div className={triggerClass} title={chipTitle(localCheckoutLabel)}>
          {localChip}
        </div>
      )
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={`${triggerClass} hover:bg-muted`} title={chipTitle(localCheckoutLabel)}>
            {localChip}
            {!compact && <ChevronDown className="size-3 text-muted-foreground" />}
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

  const pendingBase = pending?.baseBranch ?? ''
  const pendingCarry = pending?.carryLocalChanges ?? false
  const locationLabel = isPending
    ? t('chat.worktree.newWorktreeFrom', { base: pendingBase })
    : isActive
      ? (activeIsDetached
          ? (activeShortHead || t('chat.worktree.detachedLabel'))
          : (activeEntry?.branch || activeGitBranch || t('sidebar.hover.worktree')))
      : localCheckoutLabel
  const LocationIcon = isPending || isActive ? GitFork : Folder
  const fullChip = compact
    ? <LocationIcon className="size-3" />
    : <LocationChip kind={environmentKind} environment={environmentName} location={locationLabel} icon={LocationIcon} />
  const showDirty = isActive && !!activeDirty
  const dirtyDot = showDirty ? (
    <Circle className={`size-1.5 ${activeDirty!.files > 0 ? 'fill-amber-500 text-amber-500' : 'fill-muted-foreground/40 text-muted-foreground/40'}`} />
  ) : null
  const checkoutHay = `${localCheckoutLabel} ${displayHostPath(currentFolder)}`.toLowerCase()
  const showCheckout = !lowerSearch || checkoutHay.includes(lowerSearch)

  if (isOldSession) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
            title={chipTitle(locationLabel)}
          >
            {fullChip}
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
            <LocationIcon className="size-3 shrink-0 text-muted-foreground" />
            <span>{isActive ? t('sidebar.hover.worktree') : localCheckoutLabel}</span>
          </div>
          <div className="truncate px-3 pb-2 font-mono text-xs text-muted-foreground">{displayHostPath(isActive ? activePath : currentFolder)}</div>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('chat.worktree.environmentFixed', { environment: environmentName })}</p>

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
          title={chipTitle(locationLabel)}
        >
          {fullChip}
          {!compact && <ChevronDown className={`size-3 text-muted-foreground transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />}
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
            {showCheckout && (
              <button
                type="button"
                onClick={isInWorktree ? handleSwitchToLocal : undefined}
                disabled={!isInWorktree}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Folder className="size-3 shrink-0 text-muted-foreground" />
                <span className="shrink-0">{localCheckoutLabel}</span>
                <span className="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground">{displayHostPath(currentFolder)}</span>
                {!isInWorktree && <Check className="size-3 shrink-0 text-primary" />}
              </button>
            )}

            <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">{t('chat.worktree.existingHeading')}</div>
            {filteredExisting.length > 0 ? filteredExisting.map((e) => {
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
            }) : (
              <div className="px-3 py-1 text-xs text-muted-foreground">
                {lowerSearch && existingEntries.length > 0 ? t('chat.worktree.noMatches') : t('chat.worktree.noneYet')}
              </div>
            )}

            <div className="flex items-center gap-2 px-3 pt-2">
              <span className="min-w-0 flex-1 text-xs uppercase text-muted-foreground">{t('chat.worktree.createFromHeading')}</span>
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
              const isSelected = isPending && pendingBase === b
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => handleSelectBase(b)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                >
                  <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">{b}</span>
                  {isSelected && <Check className="size-3 shrink-0 text-primary" />}
                </button>
              )
            })}
            {filteredTracking.map((ref) => {
              const isSelected = isPending && pendingBase === ref
              return (
                <button
                  key={ref}
                  type="button"
                  onClick={() => handleSelectBase(ref)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                >
                  <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{ref}</span>
                  <span className="shrink-0 text-muted-foreground">{t('chat.git.remoteRef')}</span>
                  {isSelected && <Check className="size-3 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>

          {isPending && (
            <button
              type="button"
              onClick={handleToggleCarry}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-xs hover:bg-accent"
            >
              <div className={`flex size-3.5 items-center justify-center rounded-sm border ${pendingCarry ? 'border-foreground bg-foreground' : 'border-muted-foreground'}`}>
                {pendingCarry && <Check className="size-2.5 text-background" />}
              </div>
              <span>{t('chat.worktree.carryLocalChanges')}</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
