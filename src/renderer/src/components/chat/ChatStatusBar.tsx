import { useEffect, useState, useCallback } from 'react'
import { GitBranch, ChevronDown, ShieldCheck, Check, Circle, Plus, Monitor, GitFork } from 'lucide-react'
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
import type { GitInfo, WorktreeInfo } from '../../../../shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

interface FailedCheckout {
  branch: string
  error: string
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createBaseBranch, setCreateBaseBranch] = useState('')
  const [createBranchName, setCreateBranchName] = useState('')

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
      ]).then(([info, br]) => {
        if (info) setWorktreeInfo(info)
        setBranches(br)
      })
    }
  }, [currentFolder])

  const handleSelectWorktree = useCallback((branch: string) => {
    if (!currentFolder) return
    setPopoverOpen(false)
    // Existing worktree — use the branch directly (no base needed)
    useAppStore.getState().setPendingWorktree(currentFolder, branch, branch)
  }, [currentFolder])

  const handleClickBranch = useCallback((baseBranch: string) => {
    setPopoverOpen(false)
    setCreateBaseBranch(baseBranch)
    setCreateBranchName('')
    setCreateDialogOpen(true)
  }, [])

  const branchNameError = (() => {
    const name = createBranchName.trim()
    if (!name) return ''
    if (branches.includes(name)) return 'Branch already exists'
    if (/\s/.test(name)) return 'Cannot contain spaces'
    if (/\.\./.test(name)) return 'Cannot contain ".."'
    if (/[~^:?*\[\\]/.test(name)) return 'Contains invalid characters'
    if (name.startsWith('-') || name.startsWith('.')) return 'Cannot start with "-" or "."'
    if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return 'Invalid ending'
    if (/\/\//.test(name)) return 'Cannot contain consecutive slashes'
    return ''
  })()

  const canConfirm = createBranchName.trim().length > 0 && !branchNameError

  const handleConfirmCreate = useCallback(() => {
    if (!currentFolder || !canConfirm) return
    useAppStore.getState().setPendingWorktree(currentFolder, createBranchName.trim(), createBaseBranch)
    setCreateDialogOpen(false)
    setCreateBranchName('')
    setCreateBaseBranch('')
  }, [currentFolder, createBranchName, createBaseBranch, canConfirm])

  const handleSwitchToLocal = useCallback(() => {
    if (!currentFolder) return
    setPopoverOpen(false)
    useAppStore.getState().clearWorktree(currentFolder)
  }, [currentFolder])

  if (!worktreeInfo) return null

  const isPending = !!wtState?.pendingBranch
  const isActive = !!wtState?.activePath
  const isInWorktree = isPending || isActive
  const worktreeLabel = wtState?.pendingBranch ?? worktreeBranch ?? wtState?.activePath?.split('/').pop() ?? ''

  // Worktree already activated (message sent) — locked, no dropdown
  if (isActive) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <span className="text-muted-foreground">Worktree:</span>
        <GitFork className="size-3" />
        <span>{worktreeLabel}</span>
      </div>
    )
  }

  // Worktree session restored from history — locked indicator with branch
  if (worktreeBranch && !isInWorktree) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <span className="text-muted-foreground">Worktree:</span>
        <GitFork className="size-3" />
        <span>{worktreeBranch}</span>
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

  const otherWorktrees = worktreeInfo.entries.filter((e) => !e.isMain)
  const worktreeBranches = new Set(otherWorktrees.map((e) => e.branch))
  const lowerSearch = search.toLowerCase()
  // Branches without an existing worktree — potential base for new worktree
  const filteredBranches = branches.filter(
    (b) => b.toLowerCase().includes(lowerSearch) && !worktreeBranches.has(b)
  )
  const filteredWorktrees = otherWorktrees.filter(
    (e) => e.branch.toLowerCase().includes(lowerSearch)
  )

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={openPopover}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground">
            {isPending ? (
              <>
                <GitFork className="size-3" />
                <span>{worktreeLabel}</span>
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
              placeholder="Search worktrees or branches…"
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

              {/* Existing worktrees */}
              {filteredWorktrees.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Worktrees">
                    {filteredWorktrees.map((wt) => (
                      <CommandItem
                        key={wt.path}
                        value={wt.path}
                        onSelect={() => handleSelectWorktree(wt.branch)}
                        className="gap-2 text-xs"
                      >
                        <GitFork className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{wt.branch}</span>
                        {wtState?.pendingBranch === wt.branch && <Check className="size-3 shrink-0 text-foreground" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Create worktree from branch — only in Local mode */}
              {!isInWorktree && filteredBranches.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Create Worktree from…">
                    {filteredBranches.map((b) => (
                      <CommandItem
                        key={b}
                        value={`__wt_create__${b}`}
                        onSelect={() => handleClickBranch(b)}
                        className="gap-2 text-xs"
                      >
                        <Plus className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{b}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {filteredWorktrees.length === 0 && filteredBranches.length === 0 && search.trim().length > 0 && (
                <CommandEmpty>No matches</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Create worktree dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Worktree</DialogTitle>
            <DialogDescription>
              Create a new branch from <strong>{createBaseBranch}</strong>. The worktree will be created when you send your next message.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="mb-1.5 block text-xs text-muted-foreground">New branch name</label>
            <input
              className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 ${branchNameError ? 'border-destructive focus-visible:ring-destructive' : 'border-input focus-visible:ring-ring'}`}
              value={createBranchName}
              onChange={(e) => setCreateBranchName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && canConfirm) handleConfirmCreate() }}
              placeholder="e.g. feature/my-branch"
              autoFocus
            />
            {branchNameError && (
              <p className="mt-1.5 text-xs text-destructive">{branchNameError}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmCreate} disabled={!canConfirm}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ChatStatusBar() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const worktrees = useAppStore((s) => s._worktrees)
  const sandboxInfo = useActiveSession((s) => s.sandboxInfo)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [failedCheckout, setFailedCheckout] = useState<FailedCheckout | null>(null)

  const worktreeBranch = useActiveSession((s) => s._worktreeBranch)
  const wtState = currentFolder ? worktrees[currentFolder] : undefined
  const isInWorktree = !!(wtState?.pendingBranch || wtState?.activePath)

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

        {/* Sandbox status */}
        {sandboxInfo.enabled && (
          <>
            <div className="h-3 w-px bg-border" />
            <div
              className="flex items-center gap-1 text-emerald-400"
              title={sandboxInfo.autoAllowBash ? 'Sandbox enabled, Bash auto-allowed' : 'Sandbox enabled'}
            >
              <ShieldCheck className="size-3" />
              <span>Sandbox{sandboxInfo.autoAllowBash ? ' (Auto)' : ''}</span>
            </div>
          </>
        )}

        <div className="h-3 w-px bg-border" />

        {/* Permission mode */}
        <PermissionModeSelector />
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
