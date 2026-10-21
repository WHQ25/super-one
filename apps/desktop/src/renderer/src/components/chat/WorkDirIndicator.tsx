import { useEffect, useState, useCallback, useMemo, type ComponentType, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GitBranch, GitFork, ChevronDown, Check, Circle, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Button } from '@superone/ui/components/ui/button'
import { useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useOnTurnCompleted } from '@/hooks/useOnTurnCompleted'
import type { GitDirtyStatus, GitInfoResult, WorktreeEntry, WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
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
import { GitBranchMenu } from './GitBranchMenu'

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

/** Status-bar chip: environment, then the branch or worktree label. */
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

type LocationMode = 'checkout' | 'worktree'

interface WorkDirIndicatorProps {
  compact?: boolean
  isGitRepo?: boolean | null
  /** Parent refreshes its repo flag after a successful git init. */
  onRepositoryReady?: () => void
}

interface WtMeta {
  dirty?: GitDirtyStatus
  shortHead: string
  baseBranch?: string | null
  isDetached: boolean
}

interface FailedCheckout {
  branch: string
  error: string
}

const fmt = (n: number) => n.toLocaleString()

/**
 * GIT_INFO omits `dirty` for a clean checkout, but this popover distinguishes
 * "known clean" (renders `clean` / the grey dot) from "unknown" (blank line):
 * a successful read with no changes is clean; a failed read stays undefined.
 */
const knownDirty = (info: GitInfoResult | null | undefined): GitDirtyStatus | undefined =>
  info && info.branch !== null ? (info.dirty ?? { files: 0, insertions: 0, deletions: 0 }) : undefined

function branchDirtyDetail(dirty: GitDirtyStatus | undefined): ReactNode {
  if (!dirty || dirty.files <= 0) return null
  return (
    <span className="text-xs text-muted-foreground">
      uncommitted: {fmt(dirty.files)} {dirty.files === 1 ? 'file' : 'files'}
      {(dirty.insertions > 0 || dirty.deletions > 0) && (
        <>
          {dirty.insertions > 0 && <span className="ml-1 text-green-500">+{fmt(dirty.insertions)}</span>}
          {dirty.deletions > 0 && <span className="ml-1 text-red-500">-{fmt(dirty.deletions)}</span>}
        </>
      )}
    </span>
  )
}

function CheckoutPanel({
  isGitRepo,
  environment,
  branch,
  dirty,
  local,
  loading,
  emptyLabel,
  initing,
  onInit,
  onSelect,
  onCreate,
}: {
  isGitRepo?: boolean | null
  environment: string
  branch: string | null
  dirty: GitDirtyStatus | undefined
  local: string[]
  loading: boolean
  emptyLabel?: string
  initing: boolean
  onInit: () => void
  onSelect: (branch: string) => void
  onCreate: (name: string) => void
}) {
  const { t } = useTranslation()
  if (isGitRepo === false) {
    return (
      <>
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('chat.worktree.notAGitRepo')}</p>
        <button
          type="button"
          onClick={onInit}
          disabled={initing}
          className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
        >
          <Plus className="size-3 shrink-0 text-muted-foreground" />
          <span>{t('chat.git.initOn', { environment })}</span>
        </button>
      </>
    )
  }
  return (
    <GitBranchMenu
      current={branch}
      currentDetail={branchDirtyDetail(dirty)}
      local={local}
      loading={loading}
      emptyLabel={emptyLabel}
      onSelect={onSelect}
      onCreate={onCreate}
    />
  )
}

function WorktreeDraftPanel({
  entries,
  metas,
  activePath,
  local,
  pendingBase,
  pending,
  loading,
  emptyEntriesLabel,
  emptyBranchesLabel,
  attachReason,
  onSelectExisting,
  onSelectBase,
}: {
  entries: WorktreeEntry[]
  metas: Record<string, WtMeta>
  activePath: string | null
  local: string[]
  pendingBase: string
  pending: boolean
  loading: boolean
  emptyEntriesLabel: string
  emptyBranchesLabel: string
  attachReason: (branch: string) => string | null
  onSelectExisting: (entry: WorktreeEntry) => void
  onSelectBase: (base: string) => void
}) {
  const { t } = useTranslation()
  const noBranches = local.length === 0
  return (
    <div className="flex flex-col">
      <div className="max-h-80 overflow-y-auto">
        <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">{t('chat.worktree.existingHeading')}</div>
        {entries.length > 0 ? entries.map((entry) => {
          const meta = metas[entry.path]
          const detached = !entry.branch
          return (
            <WorktreeEntryRow
              key={entry.path}
              label={detached ? `${t('chat.worktree.detachedLabel')} ${meta?.shortHead ?? ''}` : entry.branch!}
              detached={detached}
              dirty={meta?.dirty}
              isCurrent={sameWorktreePath(entry.path, activePath)}
              onClick={() => onSelectExisting(entry)}
            />
          )
        }) : (
          <div className="px-3 py-1 text-xs text-muted-foreground">{emptyEntriesLabel}</div>
        )}

        <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">{t('chat.worktree.createFromHeading')}</div>
        {loading && (
          <div className="px-3 py-1 text-xs text-muted-foreground">{t('common.loading')}</div>
        )}
        {noBranches && !loading && (
          <div className="px-3 py-1 text-xs text-muted-foreground">{emptyBranchesLabel}</div>
        )}
        {local.map((branch) => {
          const reason = pending && pendingBase ? attachReason(branch) : null
          const selected = pending && pendingBase === branch
          return (
            <button
              key={branch}
              type="button"
              disabled={!!reason}
              onClick={() => onSelectBase(branch)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate">{branch}</span>
                {reason && <span className="truncate text-muted-foreground">{reason}</span>}
              </span>
              {selected && <Check className="mt-0.5 size-3 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function WorktreeCreatePanel({
  base,
  mode,
  branchName,
  branchExists,
  carry,
  dirty,
  showAttach,
  attachReason,
  onMode,
  onBranchName,
  onCarry,
}: {
  base: string
  mode: WorktreeMode
  branchName: string
  branchExists: boolean
  carry: boolean
  dirty: GitDirtyStatus | undefined
  showAttach: boolean
  attachReason: string | null
  onMode: (mode: WorktreeMode) => void
  onBranchName: (name: string) => void
  onCarry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="border-t p-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {t('chat.worktree.baseBranchLabel')}: <span className="font-mono text-foreground">{base}</span>
      </div>
      <div className="mb-3 flex gap-1 rounded-md bg-muted p-0.5">
        <ModeButton active={mode === 'branch'} onClick={() => onMode('branch')}>{t('chat.worktree.modeBranch')}</ModeButton>
        {showAttach && (
          <ModeButton active={mode === 'attach'} onClick={() => onMode('attach')}>{t('chat.worktree.modeAttach')}</ModeButton>
        )}
        <ModeButton active={mode === 'detach'} onClick={() => onMode('detach')}>{t('chat.worktree.modeDetach')}</ModeButton>
      </div>
      {mode === 'branch' && (
        <>
          <label className="mb-1 block text-xs text-muted-foreground">{t('chat.worktree.branchNameLabel')}</label>
          <input
            type="text"
            placeholder={t('chat.worktree.branchNamePlaceholder')}
            value={branchName}
            onChange={(event) => onBranchName(event.target.value)}
            className={`mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 ${branchExists ? 'border-red-500 focus:ring-red-500' : 'border-input focus:ring-ring'}`}
          />
          {branchExists && (
            <div className="mb-3 flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
              <span>{t('chat.worktree.branchExists', { name: branchName.trim() })}</span>
              <button
                type="button"
                onClick={() => onMode('attach')}
                className="ml-2 rounded border border-current px-1.5 py-0.5 text-xs hover:bg-red-500/20"
              >
                {t('chat.worktree.switchToAttach')}
              </button>
            </div>
          )}
        </>
      )}
      {mode === 'attach' && (
        <div className="mb-3 rounded-md bg-muted px-2 py-2 text-xs text-muted-foreground">
          {attachReason ?? t('chat.worktree.attachInfo', { branch: base })}
        </div>
      )}
      {mode === 'detach' && (
        <div className="mb-3 rounded-md bg-muted px-2 py-2 text-xs text-muted-foreground">
          {t('chat.worktree.detachInfo', { branch: base, hash: '...' })}
        </div>
      )}
      {dirty && dirty.files > 0 && (
        <button
          type="button"
          onClick={onCarry}
          className="flex w-full items-center gap-2 rounded-sm py-1 text-xs hover:bg-accent"
        >
          <div className={`flex size-3.5 items-center justify-center rounded-sm border ${carry ? 'border-foreground bg-foreground' : 'border-muted-foreground'}`}>
            {carry && <Check className="size-2.5 text-background" />}
          </div>
          <span>{t('chat.worktree.carryLocalChanges')}</span>
          <span className="ml-auto text-muted-foreground"><DiffStat stat={dirty} /></span>
        </button>
      )}
      <div className="mt-2 text-xs text-muted-foreground">{t('chat.worktree.lazyHint')}</div>
    </div>
  )
}

export function WorkDirIndicator({ compact = false, isGitRepo, onRepositoryReady }: WorkDirIndicatorProps) {
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
  const [mode, setMode] = useState<LocationMode>('checkout')
  const [search, setSearch] = useState('')
  const [branchLists, setBranchLists] = useState<GitBranchLists>(EMPTY_BRANCH_LISTS)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [mainBranch, setMainBranch] = useState<string | null>(null)
  const [mainDirty, setMainDirty] = useState<GitDirtyStatus | undefined>()
  const [wtMetas, setWtMetas] = useState<Record<string, WtMeta>>({})
  const [checkedOutBranches, setCheckedOutBranches] = useState<Set<string>>(new Set())
  const [activeDirty, setActiveDirty] = useState<GitDirtyStatus | undefined>()
  const [initing, setIniting] = useState(false)
  const [failedCheckout, setFailedCheckout] = useState<FailedCheckout | null>(null)

  const activePath = location.selection.kind === 'existing' ? location.selection.path : null
  const isRemoteProject = Boolean(currentFolder && parseRemoteProjectKey(currentFolder))
  const fallbackEnvironment = typeof window !== 'undefined' && window.app.platform === 'darwin'
    ? t('sidebar.thisMac')
    : t('sidebar.thisPc')
  const environmentName = environmentBucket?.label || fallbackEnvironment
  const environmentKind: EnvironmentKind = environmentBucket?.kind ?? (isRemoteProject ? 'cli-node' : 'local')
  const localCheckoutLabel = t('chat.worktree.localCheckout')

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
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentFolder, isGitRepo, activePath])

  // The chip names the shared checkout's branch before the popover opens.
  useEffect(() => {
    if (!currentFolder || isGitRepo === false) {
      setMainBranch(null)
      return
    }
    let cancelled = false
    const read = () => {
      window.app.getGitInfo(currentFolder).then((info) => {
        if (cancelled) return
        setMainBranch(info?.branch ?? null)
        setMainDirty(info?.dirty)
      }).catch(() => {})
    }
    read()
    const unsub = window.app.onGitHeadChange((evt) => {
      if (!evt.folderPath || evt.folderPath === currentFolder) read()
    })
    return () => { cancelled = true; unsub() }
  }, [currentFolder, isGitRepo])

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
    if (!currentFolder || isGitRepo === false) return
    setBranchesLoading(true)
    try {
      const [info, br, gitInfo, checkedOut] = await Promise.all([
        window.app.getWorktreeInfo(currentFolder),
        window.app.getGitBranches(currentFolder),
        window.app.getGitInfo(currentFolder),
        window.app.getCheckedOutBranches(currentFolder),
      ])
      setWorktreeInfo(info)
      setBranchLists(readBranchLists(br))
      setMainBranch(gitInfo?.branch ?? null)
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
    } catch {
      // Keep the last lists. The checkout tab shows its own empty state.
    } finally {
      setBranchesLoading(false)
    }
  }, [currentFolder, isGitRepo])

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
      setMode(isGitRepo !== false && location.selection.kind !== 'local' ? 'worktree' : 'checkout')
      void loadPopoverData()
    }
  }, [loadPopoverData, currentFolder, location.selection, location.environmentId, isGitRepo])

  const resetToCheckout = useCallback(() => {
    if (!currentFolder || location.selection.kind === 'local') return
    writeFocusedSelection(currentFolder, selectionForNewSession(location.environmentId), {
      cwd: currentFolder,
      worktreePath: null,
      gitBranch: null,
    })
    void useAppStore.getState().clearWorktree(currentFolder)
  }, [currentFolder, location.environmentId, location.selection.kind])

  const selectMode = useCallback((next: string) => {
    setSearch('')
    if (next === 'worktree') {
      if (isGitRepo === false) return
      setMode('worktree')
      return
    }
    setMode('checkout')
    resetToCheckout()
  }, [isGitRepo, resetToCheckout])

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
    // Default to a named branch. Detach and attach stay one click away, and a
    // branch name is what the next message needs for branch mode.
    const carry = location.selection.kind === 'create' && location.selection.carryLocalChanges
    const store = useAppStore.getState()
    store.setPendingWorktree(currentFolder, baseBranch)
    if (carry) store.setPendingCarryLocalChanges(currentFolder, true)
    patchFocusedCreate(currentFolder, {
      baseBranch,
      mode: 'branch',
      branchName: '',
      carryLocalChanges: carry,
    })
  }, [currentFolder, location.selection])

  const handleSetMode = useCallback((next: WorktreeMode) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingMode(currentFolder, next)
    patchFocusedCreate(currentFolder, { mode: next })
  }, [currentFolder])

  const handleSetBranchName = useCallback((name: string) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingBranchName(currentFolder, name)
    patchFocusedCreate(currentFolder, { branchName: name })
  }, [currentFolder])

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

  const handleBranchSelect = useCallback(async (branch: string, track?: string) => {
    // The checkout tab switches the shared project checkout, never a worktree path.
    if (!currentFolder || (!track && branch === mainBranch)) return
    setPopoverOpen(false)
    const result = await window.app.switchGitBranch(currentFolder, branch, track)
    const info = await window.app.getGitInfo(currentFolder).catch(() => null)
    setMainBranch(info?.branch ?? null)
    setMainDirty(info?.dirty)
    if (!result.ok) setFailedCheckout({ branch, error: result.error ?? '' })
  }, [currentFolder, mainBranch])

  const handleCreateBranch = useCallback(async (name: string) => {
    if (!currentFolder) return
    setPopoverOpen(false)
    const result = await window.app.createBranch(currentFolder, name)
    if (result.ok) {
      const info = await window.app.getGitInfo(currentFolder).catch(() => null)
      setMainBranch(info?.branch ?? name)
      setMainDirty(info?.dirty)
    } else {
      setFailedCheckout({ branch: name, error: result.error ?? '' })
    }
  }, [currentFolder])

  const handleGitInit = useCallback(async () => {
    if (!currentFolder || initing) return
    setIniting(true)
    try {
      const result = await window.app.gitInit(currentFolder)
      if (result.ok) {
        toast.success(t('chat.git.initSuccess'))
        onRepositoryReady?.()
        void loadPopoverData()
      } else {
        toast.error(t('chat.git.initFailed', { error: result.error ?? '' }))
      }
    } finally {
      setIniting(false)
    }
  }, [currentFolder, initing, loadPopoverData, onRepositoryReady, t])

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

  const modeValue: LocationMode = isGitRepo === false ? 'checkout' : mode
  const query = search.trim()
  const lowerQuery = query.toLowerCase()
  const filteredExisting = useMemo(() => {
    if (modeValue !== 'worktree' || !lowerQuery) return existingEntries
    return existingEntries.filter((entry) => {
      const meta = wtMetas[entry.path]
      return [entry.branch, meta?.shortHead, entry.path].filter(Boolean).join(' ').toLowerCase().includes(lowerQuery)
    })
  }, [existingEntries, wtMetas, lowerQuery, modeValue])
  const filteredLocal = useMemo(() => {
    if (modeValue !== 'checkout' || !lowerQuery) return branchLists.local
    return branchLists.local.filter((branch) => branch.toLowerCase().includes(lowerQuery))
  }, [branchLists.local, lowerQuery, modeValue])

  const pending = location.selection.kind === 'create' ? location.selection : null
  const isPending = !!pending
  const isActive = location.selection.kind === 'existing'
  const startedWorktree = isOldSession && location.selection.kind !== 'local'

  const activeEntry = isActive
    ? existingEntries.find((e) => sameWorktreePath(e.path, activePath))
    : undefined
  const activeIsDetached = activeEntry ? !activeEntry.branch : false
  const activeShortHead = activeEntry?.head ? activeEntry.head.slice(0, 7) : ''
  const pendingBase = pending?.baseBranch ?? ''
  const pendingMode = pending?.mode ?? 'branch'
  const pendingBranchName = pending?.branchName ?? ''
  const pendingCarry = pending?.carryLocalChanges ?? false
  const branchNameTaken = pendingMode === 'branch'
    && pendingBranchName.trim().length > 0
    && branchLists.local.includes(pendingBranchName.trim())
  const checkedOutReason = (branch: string): string | null => {
    if (!worktreeInfo || !checkedOutBranches.has(branch)) return null
    const mainEntry = worktreeInfo.entries.find((entry) => entry.isMain)
    if (mainEntry?.branch === branch) return t('chat.worktree.attachUnavailableMain')
    return t('chat.worktree.attachUnavailableOther')
  }
  const canCreateFromSearch = modeValue === 'checkout'
    && isGitRepo !== false
    && query.length > 0
    && query !== mainBranch
    && !branchLists.local.includes(query)
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    if (!query || isGitRepo === false || modeValue !== 'checkout') return
    if (branchLists.local.includes(query) || query === mainBranch) {
      void handleBranchSelect(query)
      return
    }
    void handleCreateBranch(query)
  }
  const environmentOptions: WorkDirEnvironmentOption[] = environmentMenu.options.length > 0
    ? environmentMenu.options
    : [{
        environmentId: location.environmentId || 'local',
        connectionId: location.environmentId || 'local',
        label: environmentName,
        kind: 'current',
        needsUpgrade: false,
        hostKind: environmentKind,
      }]
  const locationLabel = isGitRepo === false
    ? t('chat.git.uninitialized')
    : isPending
      ? t('chat.worktree.newWorktreeFrom', { base: pendingBase })
      : isActive
        ? (activeIsDetached
            ? (activeShortHead || t('chat.worktree.detachedLabel'))
            : (activeEntry?.branch || activeGitBranch || t('sidebar.hover.worktree')))
        : (mainBranch || localCheckoutLabel)
  const LocationIcon = isGitRepo !== false && (isPending || isActive) ? GitFork : GitBranch
  const showActiveDirty = isActive && !!activeDirty
  const dirtyDot = isGitRepo === false || isPending
    ? null
    : showActiveDirty
      ? (
        <Circle className={`size-1.5 ${activeDirty!.files > 0 ? 'fill-amber-500 text-amber-500' : 'fill-muted-foreground/40 text-muted-foreground/40'}`} />
      )
      : (!isActive && mainDirty && mainDirty.files > 0
        ? <Circle className="size-1.5 fill-amber-500 text-amber-500" />
        : null)
  const chipTitle = `${environmentName} · ${locationLabel}`

  const environmentMenuNode = (
    <WorkDirEnvironmentMenu
      visible
      loading={environmentMenu.loading}
      error={environmentError}
      readOnly={isOldSession}
      options={environmentOptions}
      selectedId={location.environmentId}
      onSelect={handleSelectEnvironment}
      onClone={handleCloneEnvironment}
    />
  )

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={openPopover}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
            title={chipTitle}
          >
            {compact
              ? <LocationIcon className="size-3" />
              : <LocationChip kind={environmentKind} environment={environmentName} location={locationLabel} icon={LocationIcon} />}
            {dirtyDot}
            {!compact && <ChevronDown className={`size-3 text-muted-foreground transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          {environmentMenuNode}
          {startedWorktree ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <GitFork className="size-3 shrink-0 text-muted-foreground" />
                <span>{t('sidebar.hover.worktree')}</span>
              </div>
              <div className="truncate px-3 pb-2 font-mono text-xs text-muted-foreground">{displayHostPath(activePath)}</div>
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
            </>
          ) : (
            <>
              {isOldSession && (
                <p className="px-3 py-2 text-xs text-muted-foreground">{t('chat.worktree.environmentFixed', { environment: environmentName })}</p>
              )}
              <Tabs value={modeValue} onValueChange={selectMode}>
                <div className="px-3 pt-2">
                  <TabsList className="h-9 w-full">
                    <TabsTrigger value="checkout" className="py-1.5">{t('chat.worktree.modeLocal')}</TabsTrigger>
                    <TabsTrigger value="worktree" className="py-1.5" disabled={isGitRepo === false}>{t('sidebar.hover.worktree')}</TabsTrigger>
                  </TabsList>
                </div>
                <form className="border-b px-3 py-2" onSubmit={submitSearch}>
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={modeValue === 'worktree' ? t('chat.worktree.searchPlaceholder') : t('chat.git.searchBranches')}
                    className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </form>
                {canCreateFromSearch && (
                  <button
                    type="button"
                    onClick={() => { void handleCreateBranch(query) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <Plus className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{t('chat.git.createBranch', { name: query })}</span>
                  </button>
                )}
                <TabsContent value="checkout">
                  <CheckoutPanel
                    isGitRepo={isGitRepo}
                    environment={environmentName}
                    branch={modeValue === 'checkout' && (!lowerQuery || (mainBranch ?? '').toLowerCase().includes(lowerQuery)) ? mainBranch : null}
                    dirty={mainDirty}
                    local={filteredLocal}
                    loading={branchesLoading}
                    emptyLabel={query && modeValue === 'checkout' ? t('chat.worktree.noMatches') : undefined}
                    initing={initing}
                    onInit={() => { void handleGitInit() }}
                    onSelect={(branch) => { void handleBranchSelect(branch) }}
                    onCreate={(name) => { void handleCreateBranch(name) }}
                  />
                </TabsContent>
                <TabsContent value="worktree">
                  {isOldSession ? (
                    activeSessionId && currentFolder ? (
                      <WorktreeForkSection
                        sessionId={activeSessionId}
                        cwd={currentFolder}
                        onForked={() => setPopoverOpen(false)}
                      />
                    ) : null
                  ) : (
                    <>
                      <WorktreeDraftPanel
                        entries={filteredExisting}
                        metas={wtMetas}
                        activePath={activePath}
                        local={modeValue === 'worktree' ? branchLists.local : filteredLocal}
                        pendingBase={pendingBase}
                        pending={isPending}
                        loading={branchesLoading}
                        emptyEntriesLabel={modeValue === 'worktree' && query && existingEntries.length > 0 ? t('chat.worktree.noMatches') : t('chat.worktree.noneYet')}
                        emptyBranchesLabel={t('chat.git.noBranches')}
                        attachReason={(branch) => pendingMode === 'attach' ? checkedOutReason(branch) : null}
                        onSelectExisting={handleSwitchToExisting}
                        onSelectBase={handleSelectBase}
                      />
                      {pending && (
                        <WorktreeCreatePanel
                          base={pendingBase}
                          mode={pending.mode}
                          branchName={pendingBranchName}
                          branchExists={branchNameTaken}
                          carry={pendingCarry}
                          dirty={mainDirty}
                          showAttach={!checkedOutReason(pendingBase)}
                          attachReason={checkedOutReason(pendingBase)}
                          onMode={handleSetMode}
                          onBranchName={handleSetBranchName}
                          onCarry={handleToggleCarry}
                        />
                      )}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </PopoverContent>
      </Popover>
      <Dialog open={!!failedCheckout} onOpenChange={(open) => { if (!open) setFailedCheckout(null) }}>
        <DialogContent className="sm:max-w-md overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle>Checkout Failed</DialogTitle>
            <DialogDescription asChild>
              <div className="min-w-0 space-y-3 pt-1">
                <p>
                  Failed to switch to <strong>{failedCheckout?.branch}</strong>.
                </p>
                <pre className="min-w-0 max-w-full whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {failedCheckout?.error}
                </pre>
                {mainDirty && mainDirty.files > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tip: Commit your changes first, then switch branches.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setFailedCheckout(null)}>
              Cancel
            </Button>
            {mainDirty && mainDirty.files > 0 && (
              <Button onClick={() => {
                useChatStore.getState().setDraftText('make a commit')
                setFailedCheckout(null)
              }}>
                Commit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
