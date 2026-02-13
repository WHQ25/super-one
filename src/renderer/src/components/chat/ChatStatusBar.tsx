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

  const detachedWorktrees = worktreeInfo.entries.filter((e) => !e.isMain && !e.branch)
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

            {/* Detached worktrees (read-only display) */}
            {detachedWorktrees.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Detached Worktrees">
                  {detachedWorktrees.map((wt) => (
                    <CommandItem
                      key={wt.path}
                      value={wt.path}
                      disabled
                      className="gap-2 text-xs opacity-60"
                    >
                      <GitFork className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono">{wt.head.slice(0, 7)}</span>
                      <span className="text-muted-foreground">(detached)</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

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
        </Command>
      </PopoverContent>
    </Popover>
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
