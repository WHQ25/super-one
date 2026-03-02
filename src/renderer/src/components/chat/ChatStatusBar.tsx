import { useEffect, useState, useCallback } from 'react'
import { GitBranch, ChevronDown, Check, Circle, Plus } from 'lucide-react'
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
import { CodexPermissionSelector } from './CodexPermissionSelector'
import { WorkDirIndicator } from './WorkDirIndicator'
import type { GitInfo } from '../../../../shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

interface FailedCheckout {
  branch: string
  error: string
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

  const worktreeBaseBranch = useActiveSession((s) => s._worktreeBaseBranch)
  const wtState = currentFolder ? worktrees[currentFolder] : undefined
  const isInWorktree = !!(wtState?.pendingBaseBranch || (wtState?.activePath && worktreeBaseBranch))

  const refreshGitInfo = useCallback(async () => {
    if (!currentFolder) return
    const info = await window.app.getGitInfo(currentFolder)
    if (info) setGitInfo(info)
  }, [currentFolder])

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

  useEffect(() => {
    const unsub = window.app.onGitHeadChange(() => refreshGitInfo())
    return unsub
  }, [refreshGitInfo])

  const openPopover = useCallback((open: boolean) => {
    setPopoverOpen(open)
    if (open) {
      setSearch('')
      if (currentFolder) window.app.getGitBranches(currentFolder).then(setBranches)
    }
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
  const normalizedTrimmed = trimmed.toLowerCase()
  const currentBranchLower = gitInfo?.branch.toLowerCase()
  const canCreate = trimmed.length > 0
    && normalizedTrimmed !== currentBranchLower
    && !branches.some((b) => b.toLowerCase() === normalizedTrimmed)

  return (
    <>
      <div className="flex items-center gap-2 px-7 pb-3 pt-1 text-[11px] text-muted-foreground">
        {gitInfo && <WorkDirIndicator />}

        {gitInfo && !isInWorktree && !worktreeBaseBranch && (
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

        {preferredProvider === 'claude' ? (
          <PermissionModeSelector />
        ) : (
          <CodexPermissionSelector />
        )}

        <div className="flex-1" />

        {preferredProvider === 'claude' && <SandboxModeSelector />}
      </div>

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
