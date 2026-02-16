import { useEffect, useState, useCallback } from 'react'
import { GitBranch, ChevronDown, ShieldCheck, Check, Circle, Plus, Monitor, GitFork, ShieldOff, AlertTriangle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { PermissionModeSelector } from './PermissionModeSelector'
import { SandboxModeSelector } from './SandboxModeSelector'
import {
  DEFAULT_CODEX_PERMISSION_PRESET,
  type CodexPermissionPreset,
  type GitDirtyStatus,
  type GitInfo,
  type WorktreeInfo,
} from '../../../../shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

interface FailedCheckout {
  branch: string
  error: string
}

function CodexPermissionSummary() {
  const [open, setOpen] = useState(false)
  const selectedPreset = useActiveSession((s) => s.selectedCodexPermissionPreset)
  const setSelectedPreset = useChatStore((s) => s.setSelectedCodexPermissionPreset)
  const preset: CodexPermissionPreset = selectedPreset || DEFAULT_CODEX_PERMISSION_PRESET
  const presetLabel = preset === 'full-access' ? 'Full Access' : 'Default'

  const modeIcon = preset === 'full-access'
    ? <ShieldOff className="size-3" />
    : <ShieldCheck className="size-3" />

  const options: Array<{
    id: CodexPermissionPreset
    label: string
    icon: React.ReactNode
    toneClass: string
  }> = [
    {
      id: 'default',
      label: 'Default',
      icon: <ShieldCheck className="size-3.5" />,
      toneClass: 'text-foreground',
    },
    {
      id: 'full-access',
      label: 'Full Access',
      icon: <AlertTriangle className="size-3.5" />,
      toneClass: 'text-destructive',
    },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${
            preset === 'full-access'
              ? 'text-destructive hover:bg-destructive/10'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {modeIcon}
          <span>{presetLabel}</span>
          <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 border-border bg-card p-2">
        <div className="space-y-1 text-xs">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setSelectedPreset(option.id)
                setOpen(false)
              }}
              className={`w-full rounded px-2 py-1.5 text-left transition-colors ${
                option.id === preset
                  ? 'bg-muted text-foreground'
                  : 'text-foreground hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 font-medium ${option.toneClass}`}>
                  {option.icon}
                  {option.label}
                </span>
                {option.id === preset && <Check className="size-3.5 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function WorkDirIndicator() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const worktrees = useAppStore((s) => s._worktrees)
  const wtState = currentFolder ? worktrees[currentFolder] : undefined
  const hasMessages = useActiveSession((s) => s.messages.length > 0)
  const worktreeBranch = useActiveSession((s) => s._worktreeBranch)

  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [dirty, setDirty] = useState<GitDirtyStatus | undefined>()

  useEffect(() => {
    if (!currentFolder) { setWorktreeInfo(null); return }
    let cancelled = false
    window.app.getWorktreeInfo(currentFolder).then((info) => {
      if (!cancelled) setWorktreeInfo(info)
    })
    return () => { cancelled = true }
  }, [currentFolder])

  const openPopover = useCallback((open: boolean) => {
    setPopoverOpen(open)
    if (open && currentFolder) {
      setSearch('')
      Promise.all([
        window.app.getWorktreeInfo(currentFolder),
        window.app.getGitBranches(currentFolder),
        window.app.getGitInfo(currentFolder),
      ]).then(([info, br, gitInfo]) => {
        if (info) setWorktreeInfo(info)
        setBranches(br)
        setDirty(gitInfo?.dirty)
      })
    }
  }, [currentFolder])

  const handleCreateFromBranch = useCallback((baseBranch: string) => {
    if (!currentFolder) return
    setPopoverOpen(false)
    useAppStore.getState().setPendingWorktree(currentFolder, baseBranch)
  }, [currentFolder])

  const handleSwitchToLocal = useCallback(() => {
    if (!currentFolder) return
    setPopoverOpen(false)
    useAppStore.getState().clearWorktree(currentFolder)
  }, [currentFolder])

  if (!worktreeInfo) return null

  const isPending = !!wtState?.pendingBaseBranch
  const isActive = !!wtState?.activePath
  const isInWorktree = isPending || isActive

  // Worktree already activated (message sent) — locked, no dropdown
  if (isActive) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <GitFork className="size-3" />
        <span>Worktree</span>
      </div>
    )
  }

  // Worktree session restored from history — locked indicator
  if (worktreeBranch && !isInWorktree) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <GitFork className="size-3" />
        <span>Worktree</span>
      </div>
    )
  }

  // Local session with messages — locked to Local, no dropdown
  if (!isInWorktree && hasMessages) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <Monitor className="size-3" />
        <span>Local</span>
      </div>
    )
  }

  const lowerSearch = search.toLowerCase()
  const filteredBranches = branches.filter(
    (b) => b.toLowerCase().includes(lowerSearch)
  )

  return (
    <Popover open={popoverOpen} onOpenChange={openPopover}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground">
          {isPending ? (
            <>
              <span className="text-muted-foreground">Create worktree from:</span>
              <GitBranch className="size-3" />
              <span>{wtState?.pendingBaseBranch}</span>
            </>
          ) : (
            <>
              <Monitor className="size-3" />
              <span>Local</span>
            </>
          )}
          <ChevronDown className={`size-3 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search branches…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {/* Local (main worktree) */}
            <CommandGroup>
              <CommandItem
                onSelect={isInWorktree ? handleSwitchToLocal : undefined}
                disabled={!isInWorktree}
                className="gap-2 text-xs"
              >
                <Monitor className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">Local</span>
                {!isInWorktree && <Check className="size-3 shrink-0 text-foreground" />}
              </CommandItem>
            </CommandGroup>

            {/* Create worktree from branch — only in Local mode */}
            {filteredBranches.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Create Worktree from…">
                  {filteredBranches.map((b) => (
                    <CommandItem
                      key={b}
                      value={`__wt_create__${b}`}
                      onSelect={() => handleCreateFromBranch(b)}
                      className="gap-2 text-xs"
                    >
                      <Plus className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{b}</span>
                      {wtState?.pendingBaseBranch === b && <Check className="size-3 shrink-0 text-foreground" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {filteredBranches.length === 0 && search.trim().length > 0 && (
              <CommandEmpty>No matches</CommandEmpty>
            )}
          </CommandList>

          {dirty && (
            <>
              <CommandSeparator />
              <div className="p-1">
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                  onClick={() => currentFolder && useAppStore.getState().setCarryLocalChanges(currentFolder, !wtState?.carryLocalChanges)}
                >
                  <div className={`flex size-3.5 items-center justify-center rounded-sm border ${wtState?.carryLocalChanges ? 'border-foreground bg-foreground' : 'border-muted-foreground'}`}>
                    {wtState?.carryLocalChanges && <Check className="size-2.5 text-background" />}
                  </div>
                  <span>Carry local changes</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {fmt(dirty.files)} {dirty.files === 1 ? 'file' : 'files'}
                    {dirty.insertions > 0 && <span className="ml-1 text-green-500">+{fmt(dirty.insertions)}</span>}
                    {dirty.deletions > 0 && <span className="ml-1 text-red-500">-{fmt(dirty.deletions)}</span>}
                  </span>
                </button>
              </div>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ChatStatusBar() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const worktrees = useAppStore((s) => s._worktrees)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [failedCheckout, setFailedCheckout] = useState<FailedCheckout | null>(null)

  const worktreeBranch = useActiveSession((s) => s._worktreeBranch)
  const wtState = currentFolder ? worktrees[currentFolder] : undefined
  const isInWorktree = !!(wtState?.pendingBaseBranch || wtState?.activePath)

  useEffect(() => {
    if (!currentFolder) { setGitInfo(null); return }

    let cancelled = false
    const fetch = () => {
      window.app.getGitInfo(currentFolder).then((info) => {
        if (!cancelled) setGitInfo(info)
      })
    }
    fetch()
    const interval = setInterval(fetch, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [currentFolder])

  const openPopover = useCallback((open: boolean) => {
    setPopoverOpen(open)
    if (open) {
      setSearch('')
      if (currentFolder) window.app.getGitBranches(currentFolder).then(setBranches)
    }
  }, [currentFolder])

  const refreshGitInfo = useCallback(async () => {
    if (!currentFolder) return
    const info = await window.app.getGitInfo(currentFolder)
    if (info) setGitInfo(info)
  }, [currentFolder])

  const handleBranchSelect = useCallback(async (branch: string) => {
    if (!currentFolder || branch === gitInfo?.branch) return
    setPopoverOpen(false)
    const result = await window.app.switchGitBranch(currentFolder, branch)
    if (result.ok) {
      await refreshGitInfo()
    } else {
      await refreshGitInfo()
      setFailedCheckout({ branch, error: result.error })
    }
  }, [currentFolder, gitInfo?.branch, refreshGitInfo])

  const doCommitFirst = useCallback(() => {
    useChatStore.getState().setDraftText('make a commit')
    setFailedCheckout(null)
  }, [])

  const doCreateBranch = useCallback(async (name: string) => {
    if (!currentFolder) return
    setPopoverOpen(false)
    const result = await window.app.createBranch(currentFolder, name)
    if (result.ok) {
      await refreshGitInfo()
    } else {
      setFailedCheckout({ branch: name, error: result.error })
    }
  }, [currentFolder, refreshGitInfo])

  const dirty = gitInfo?.dirty
  const lowerSearch = search.toLowerCase()
  const currentMatch = gitInfo?.branch.toLowerCase().includes(lowerSearch)
  const otherBranches = branches.filter((b) => b !== gitInfo?.branch && b.toLowerCase().includes(lowerSearch))
  const trimmed = search.trim()
  const canCreate = trimmed.length > 0 && !branches.some((b) => b === trimmed)

  return (
    <>
      <div className="flex items-center gap-2 px-7 pb-3 pt-1 text-[11px] text-muted-foreground">
        {/* Work directory indicator — before branch */}
        {gitInfo && <WorkDirIndicator />}

        {/* Git branch switcher — hidden when in worktree */}
        {gitInfo && !isInWorktree && !worktreeBranch && (
          <>
            <div className="h-3 w-px bg-border" />
            <Popover open={popoverOpen} onOpenChange={openPopover}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground">
                  <GitBranch className="size-3" />
                  <span>{gitInfo.branch}</span>
                  {dirty && <Circle className="size-1.5 fill-amber-500 text-amber-500" />}
                  <ChevronDown className={`size-3 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search or create branch…"
                    value={search}
                    onValueChange={setSearch}
                  />
                  <CommandList>
                    {!currentMatch && otherBranches.length === 0 && !canCreate && (
                      <CommandEmpty>No branches found</CommandEmpty>
                    )}
                    {currentMatch && (
                      <CommandGroup>
                        <CommandItem
                          value={gitInfo.branch}
                          onSelect={() => handleBranchSelect(gitInfo.branch)}
                          className="gap-2 text-xs"
                        >
                          <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{gitInfo.branch}</span>
                            {dirty && (
                              <span className="text-[10px] text-muted-foreground">
                                uncommitted: {fmt(dirty.files)} {dirty.files === 1 ? 'file' : 'files'}
                                {(dirty.insertions > 0 || dirty.deletions > 0) && (
                                  <>
                                    {dirty.insertions > 0 && <span className="ml-1 text-green-500">+{fmt(dirty.insertions)}</span>}
                                    {dirty.deletions > 0 && <span className="ml-1 text-red-500">-{fmt(dirty.deletions)}</span>}
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                          <Check className="size-3 shrink-0 text-foreground" />
                        </CommandItem>
                      </CommandGroup>
                    )}
                    {otherBranches.length > 0 && (
                      <>
                        {currentMatch && <CommandSeparator />}
                        <CommandGroup>
                          {otherBranches.map((b) => (
                            <CommandItem
                              key={b}
                              value={b}
                              onSelect={() => handleBranchSelect(b)}
                              className="gap-2 text-xs"
                            >
                              <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">{b}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}
                    {canCreate && (
                      <>
                        <CommandSeparator />
                        <CommandGroup>
                          <CommandItem
                            value={`__create__${trimmed}`}
                            onSelect={() => doCreateBranch(trimmed)}
                            className="gap-2 text-xs"
                          >
                            <Plus className="size-3 shrink-0 text-muted-foreground" />
                            <span>
                              Create branch: <strong>{trimmed}</strong>
                            </span>
                          </CommandItem>
                        </CommandGroup>
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </>
        )}

        <div className="h-3 w-px bg-border" />

        {/* Provider-specific mode controls */}
        {preferredProvider === 'claude' ? (
          <PermissionModeSelector />
        ) : (
          <CodexPermissionSummary />
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sandbox mode selector — right-aligned */}
        {preferredProvider === 'claude' && <SandboxModeSelector />}
      </div>

      {/* Checkout failed dialog */}
      <Dialog open={!!failedCheckout} onOpenChange={(open) => { if (!open) setFailedCheckout(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Checkout Failed</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p>
                  Failed to switch to <strong>{failedCheckout?.branch}</strong>.
                </p>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {failedCheckout?.error}
                </pre>
                {dirty && (
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
            {dirty && (
              <Button onClick={doCommitFirst}>
                Commit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
