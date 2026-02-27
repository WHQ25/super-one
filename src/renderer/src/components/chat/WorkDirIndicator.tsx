import { useEffect, useState, useCallback } from 'react'
import { GitBranch, ChevronDown, Check, Circle, Plus, Monitor, GitFork } from 'lucide-react'
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
import { useActiveSession } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import type { WorktreeInfo, GitDirtyStatus } from '../../../../shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

export function WorkDirIndicator() {
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

  if (isActive) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <GitFork className="size-3" />
        <span>Worktree</span>
      </div>
    )
  }

  if (worktreeBranch && !isInWorktree) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1">
        <GitFork className="size-3" />
        <span>Worktree</span>
      </div>
    )
  }

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
