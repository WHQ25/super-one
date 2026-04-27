import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { GitBranch, ChevronDown, Check, Monitor, GitCommit } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useActiveSession } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import type { GitDirtyStatus, WorktreeEntry, WorktreeInfo, WorktreeMode } from '../../../../shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

interface WorkDirIndicatorProps {
  compact?: boolean
}

interface WtMeta {
  dirty?: GitDirtyStatus
  shortHead: string
  baseBranch?: string | null
  isDetached: boolean
}

export function WorkDirIndicator({ compact = false }: WorkDirIndicatorProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const worktrees = useAppStore((s) => s._worktrees)
  const wtState = currentFolder ? worktrees[currentFolder] : undefined
  const hasMessages = useActiveSession((s) => s.messages.length > 0)
  const activeBaseBranch = useActiveSession((s) => s._worktreeBaseBranch)

  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [mainDirty, setMainDirty] = useState<GitDirtyStatus | undefined>()
  const [wtMetas, setWtMetas] = useState<Record<string, WtMeta>>({})
  const [checkedOutBranches, setCheckedOutBranches] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!currentFolder) { setWorktreeInfo(null); return }
    let cancelled = false
    window.app.getWorktreeInfo(currentFolder).then((info) => {
      if (!cancelled) setWorktreeInfo(info)
    })
    return () => { cancelled = true }
  }, [currentFolder])

  const loadPopoverData = useCallback(async () => {
    if (!currentFolder) return
    const [info, br, gitInfo, checkedOut] = await Promise.all([
      window.app.getWorktreeInfo(currentFolder),
      window.app.getGitBranches(currentFolder),
      window.app.getGitInfo(currentFolder),
      window.app.getCheckedOutBranches(currentFolder),
    ])
    setWorktreeInfo(info)
    setBranches(br)
    setMainDirty(gitInfo?.dirty)
    setCheckedOutBranches(new Set(checkedOut))

    if (info?.entries?.length) {
      const nonMain = info.entries.filter((e) => !e.isMain)
      const metas: Record<string, WtMeta> = {}
      await Promise.all(nonMain.map(async (e) => {
        const wtInfo = await window.app.getGitInfo(e.path).catch(() => null)
        metas[e.path] = {
          dirty: wtInfo?.dirty,
          shortHead: e.head ? e.head.slice(0, 7) : '',
          isDetached: !e.branch,
        }
      }))
      setWtMetas(metas)
    } else {
      setWtMetas({})
    }
  }, [currentFolder])

  const openPopover = useCallback((open: boolean) => {
    setPopoverOpen(open)
    if (open) {
      setSearch('')
      void loadPopoverData()
    }
  }, [loadPopoverData])

  const handleSelectBase = useCallback((baseBranch: string) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingWorktree(currentFolder, baseBranch)
  }, [currentFolder])

  const handleSwitchToLocal = useCallback(() => {
    if (!currentFolder) return
    setPopoverOpen(false)
    void useAppStore.getState().clearWorktree(currentFolder)
  }, [currentFolder])

  const handleSwitchToExisting = useCallback((entry: WorktreeEntry) => {
    if (!currentFolder) return
    setPopoverOpen(false)
    void useAppStore.getState().switchToExistingWorktree(currentFolder, entry.path, entry.branch || null)
  }, [currentFolder])

  const handleSetMode = useCallback((mode: WorktreeMode) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingMode(currentFolder, mode)
  }, [currentFolder])

  const handleSetBranchName = useCallback((name: string) => {
    if (!currentFolder) return
    useAppStore.getState().setPendingBranchName(currentFolder, name)
  }, [currentFolder])

  const handleToggleCarry = useCallback(() => {
    if (!currentFolder || !wtState) return
    useAppStore.getState().setPendingCarryLocalChanges(currentFolder, !wtState.pendingCarryLocalChanges)
  }, [currentFolder, wtState])

  useEffect(() => {
    if (!currentFolder || !wtState?.pendingBaseBranch) return
    if (wtState.pendingMode !== 'attach') return
    if (!worktreeInfo) return
    const base = wtState.pendingBaseBranch
    if (!checkedOutBranches.has(base)) return
    useAppStore.getState().setPendingMode(currentFolder, 'branch')
  }, [currentFolder, wtState?.pendingBaseBranch, wtState?.pendingMode, worktreeInfo, checkedOutBranches])

  useEffect(() => {
    if (!currentFolder || !wtState?.pendingCarryLocalChanges) return
    if (mainDirty && mainDirty.files > 0) return
    useAppStore.getState().setPendingCarryLocalChanges(currentFolder, false)
  }, [currentFolder, wtState?.pendingCarryLocalChanges, mainDirty])

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
    if (!lowerSearch) return branches
    return branches.filter((b) => b.toLowerCase().includes(lowerSearch))
  }, [branches, lowerSearch])

  if (!worktreeInfo) return null

  const isPending = !!wtState?.pendingBaseBranch
  const isActive = !!wtState?.activePath
  const isInWorktree = isPending || isActive

  const activeEntry = isActive
    ? existingEntries.find((e) => e.path === wtState!.activePath)
    : undefined
  const activeIsDetached = activeEntry ? !activeEntry.branch : false
  const activeShortHead = activeEntry?.head ? activeEntry.head.slice(0, 7) : ''

  const pendingMode = wtState?.pendingMode ?? 'branch'
  const pendingBranchName = wtState?.pendingBranchName ?? ''
  const pendingBase = wtState?.pendingBaseBranch ?? ''
  const pendingCarry = wtState?.pendingCarryLocalChanges ?? false

  const branchExists = pendingMode === 'branch' && pendingBranchName.trim().length > 0 && branches.includes(pendingBranchName.trim())

  const attachUnavailableReason = (b: string): string | null => {
    if (!worktreeInfo) return null
    if (!checkedOutBranches.has(b)) return null
    const mainEntry = worktreeInfo.entries.find((e) => e.isMain)
    if (mainEntry && mainEntry.branch === b) return t('chat.worktree.attachUnavailableMain')
    return t('chat.worktree.attachUnavailableOther')
  }

  const CompactIcon = isActive
    ? (activeIsDetached ? GitCommit : GitBranch)
    : isPending
      ? (pendingMode === 'detach' ? GitCommit : GitBranch)
      : Monitor

  const titleText = (() => {
    if (isActive) {
      if (activeIsDetached) return `Worktree @${activeShortHead}`
      return `Worktree ${activeEntry?.branch ?? activeBaseBranch ?? ''}`
    }
    if (isPending) {
      if (pendingMode === 'detach') return `Create worktree from ${pendingBase}`
      if (pendingMode === 'attach') return `Attach worktree to ${pendingBase}`
      return `Create worktree branch ${pendingBranchName || '…'}`
    }
    return t('tooltips.local')
  })()

  const inlineBranch = <GitBranch className="inline size-3 align-middle" />
  const inlineCommit = <GitCommit className="inline size-3 align-middle" />

  const renderFullLabel = () => {
    if (isActive) {
      if (activeIsDetached) {
        return (
          <Trans
            i18nKey="chat.worktree.triggerActiveDetached"
            values={{ hash: activeShortHead }}
            components={{ commit: inlineCommit }}
          />
        )
      }
      return (
        <Trans
          i18nKey="chat.worktree.triggerActiveBranch"
          values={{ name: activeEntry?.branch ?? activeBaseBranch ?? '' }}
          components={{ branch: inlineBranch }}
        />
      )
    }
    if (isPending) {
      if (pendingMode === 'detach') {
        return (
          <Trans
            i18nKey="chat.worktree.triggerCreateFrom"
            values={{ base: pendingBase }}
            components={{ branch: inlineBranch }}
          />
        )
      }
      if (pendingMode === 'attach') {
        return (
          <Trans
            i18nKey="chat.worktree.triggerAttachTo"
            values={{ base: pendingBase }}
            components={{ branch: inlineBranch }}
          />
        )
      }
      return (
        <Trans
          i18nKey="chat.worktree.triggerCreateBranch"
          values={{ name: pendingBranchName || '…' }}
          components={{ branch: inlineBranch }}
        />
      )
    }
    return (
      <>
        <Monitor className="inline size-3 align-middle" />
        <span className="ml-1">{t('tooltips.local')}</span>
      </>
    )
  }

  const headingText = !isPending
    ? t('chat.worktree.createFromHeading')
    : pendingMode === 'attach'
      ? t('chat.worktree.attachToHeading')
      : pendingMode === 'detach'
        ? t('chat.worktree.detachAtHeading')
        : t('chat.worktree.createFromHeading')

  return (
    <Popover open={popoverOpen} onOpenChange={openPopover}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
          title={titleText}
        >
          {compact ? (
            <CompactIcon className="size-3" />
          ) : (
            <span className="flex max-w-72 items-center gap-0.5 truncate">{renderFullLabel()}</span>
          )}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex flex-col">
          <div className="border-b px-3 py-2">
            <input
              type="text"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              placeholder={t('chat.worktree.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <button
              type="button"
              onClick={isInWorktree ? handleSwitchToLocal : undefined}
              disabled={!isInWorktree}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            >
              <Monitor className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{t('tooltips.local')}</span>
              {!isInWorktree && <Check className="size-3 shrink-0 text-foreground" />}
            </button>

            {filteredExisting.length > 0 && (
              <>
                <div className="border-t" />
                <div className="px-3 pt-2 text-[10px] uppercase text-muted-foreground">{t('chat.worktree.existingHeading')}</div>
                {filteredExisting.map((e) => {
                  const meta = wtMetas[e.path]
                  const detached = !e.branch
                  const dirty = meta?.dirty
                  const filesCount = dirty?.files ?? 0
                  const isCurrent = e.path === wtState?.activePath
                  return (
                    <button
                      key={e.path}
                      type="button"
                      onClick={() => handleSwitchToExisting(e)}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                    >
                      {detached ? <GitCommit className="mt-0.5 size-3 shrink-0 text-muted-foreground" /> : <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />}
                      <div className="flex flex-1 flex-col items-start min-w-0">
                        <span className={`truncate ${detached ? 'text-muted-foreground' : ''}`}>
                          {detached ? t('chat.worktree.detachedLabel') : e.branch}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {meta?.shortHead || ''}
                        </span>
                      </div>
                      <span className={`shrink-0 text-[10px] ${filesCount > 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        {filesCount > 0 ? t('chat.worktree.filesCount', { count: filesCount }) : t('chat.worktree.cleanLabel')}
                      </span>
                      {isCurrent && <Check className="mt-0.5 size-3 shrink-0 text-foreground" />}
                    </button>
                  )
                })}
              </>
            )}

            {filteredBranches.length > 0 && (
              <>
                <div className="border-t" />
                <div className="px-3 pt-2 text-[10px] uppercase text-muted-foreground">{headingText}</div>
                {filteredBranches.map((b) => {
                  const reason = pendingMode === 'attach' ? attachUnavailableReason(b) : null
                  const disabled = pendingMode === 'attach' && !!reason
                  const isSelected = wtState?.pendingBaseBranch === b
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
                        {reason && <span className="truncate text-[10px] text-muted-foreground">{reason}</span>}
                      </div>
                      {isSelected && <Check className="mt-0.5 size-3 shrink-0 text-foreground" />}
                    </button>
                  )
                })}
              </>
            )}

            {filteredExisting.length === 0 && filteredBranches.length === 0 && search.trim().length > 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">{t('chat.worktree.noMatches')}</div>
            )}
          </div>

          {isPending && (
            <div className="border-t p-3">
              <div className="mb-2 text-[10px] text-muted-foreground">
                {t('chat.worktree.createFromHeading').split(' ')[0] || ''}: <span className="font-mono text-foreground">{pendingBase}</span>
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
                  <label className="mb-1 block text-[11px] text-muted-foreground">{t('chat.worktree.branchNameLabel')}</label>
                  <input
                    type="text"
                    placeholder={t('chat.worktree.branchNamePlaceholder')}
                    value={pendingBranchName}
                    onChange={(e) => handleSetBranchName(e.target.value)}
                    className={`mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 ${branchExists ? 'border-red-500 focus:ring-red-500' : 'border-input focus:ring-ring'}`}
                  />
                  {branchExists && (
                    <div className="mb-3 flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
                      <span>{t('chat.worktree.branchExists', { name: pendingBranchName.trim() })}</span>
                      <button
                        type="button"
                        onClick={() => handleSetMode('attach')}
                        className="ml-2 rounded border border-current px-1.5 py-0.5 text-[10px] hover:bg-red-500/20"
                      >
                        {t('chat.worktree.switchToAttach')}
                      </button>
                    </div>
                  )}
                </>
              )}

              {pendingMode === 'attach' && (
                <div className="mb-3 rounded-md bg-muted px-2 py-2 text-[11px] text-muted-foreground">
                  {(() => {
                    const reason = attachUnavailableReason(pendingBase)
                    if (reason) return reason
                    return t('chat.worktree.attachInfo', { branch: pendingBase })
                  })()}
                </div>
              )}

              {pendingMode === 'detach' && (
                <div className="mb-3 rounded-md bg-muted px-2 py-2 text-[11px] text-muted-foreground">
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
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {t('chat.worktree.filesCount', { count: mainDirty.files })}
                    {mainDirty.insertions > 0 && <span className="ml-1 text-green-500">+{fmt(mainDirty.insertions)}</span>}
                    {mainDirty.deletions > 0 && <span className="ml-1 text-red-500">-{fmt(mainDirty.deletions)}</span>}
                  </span>
                </button>
              )}

              <div className="mt-2 text-[10px] text-muted-foreground">{t('chat.worktree.lazyHint')}</div>
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
      className={`flex-1 rounded px-2 py-1 text-[11px] transition-colors ${
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
