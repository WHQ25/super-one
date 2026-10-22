/**
 * Branch chip that sat beside the worktree chip before the remote-nodes
 * experiment merged them. Shown only while that experiment is off.
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, ChevronDown, Circle, GitBranch, GitBranchPlus, Plus, TriangleAlert } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@superone/ui/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Button } from '@superone/ui/components/ui/button'
import { useChatStore } from '@/stores/chat'
import type { GitInfo } from '@superone/shared/agent-types'
import { readBranchLists } from './git-branch-lists'

interface FailedCheckout {
  branch: string
  error: string
}

const fmt = (n: number) => n.toLocaleString()

export function ClassicBranchChip({
  currentFolder,
  compact,
  gitInfo,
  isGitRepo,
  gitError,
  isInWorktree,
  sessionGitBranch,
  refreshGitInfo,
  onInitialized,
}: {
  currentFolder: string
  compact: boolean
  gitInfo: GitInfo | null
  isGitRepo: boolean | null
  gitError: string | null
  isInWorktree: boolean
  sessionGitBranch: string | null
  refreshGitInfo: () => Promise<void> | void
  onInitialized: () => void
}) {
  const { t } = useTranslation()
  const [initing, setIniting] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [failedCheckout, setFailedCheckout] = useState<FailedCheckout | null>(null)
  const dirty = gitInfo?.dirty
  const hidden = isInWorktree || !!sessionGitBranch

  const openPopover = useCallback((open: boolean) => {
    setPopoverOpen(open)
    if (open) {
      setSearch('')
      void window.app.getGitBranches(currentFolder).then((listed) => setBranches(readBranchLists(listed).local))
      void refreshGitInfo()
    }
  }, [currentFolder, refreshGitInfo])

  const handleBranchSelect = useCallback(async (branch: string) => {
    if (!gitInfo || branch === gitInfo.branch) return
    setPopoverOpen(false)
    const result = await window.app.switchGitBranch(currentFolder, branch)
    await refreshGitInfo()
    if (!result.ok) setFailedCheckout({ branch, error: result.error })
  }, [currentFolder, gitInfo, refreshGitInfo])

  const doCreateBranch = useCallback(async (name: string) => {
    setPopoverOpen(false)
    const result = await window.app.createBranch(currentFolder, name)
    if (result.ok) {
      await refreshGitInfo()
    } else {
      setFailedCheckout({ branch: name, error: result.error })
    }
  }, [currentFolder, refreshGitInfo])

  const handleGitInit = useCallback(async () => {
    if (initing) return
    setIniting(true)
    const result = await window.app.gitInit(currentFolder)
    setIniting(false)
    if (result.ok) {
      toast.success(t('chat.git.initSuccess'))
      onInitialized()
      await refreshGitInfo()
    } else {
      toast.error(t('chat.git.initFailed', { error: result.error ?? '' }))
    }
  }, [currentFolder, initing, onInitialized, refreshGitInfo, t])

  if (hidden) return null

  const lowerSearch = search.toLowerCase()
  const currentMatch = !!gitInfo && gitInfo.branch.toLowerCase().includes(lowerSearch)
  const otherBranches = gitInfo
    ? branches.filter((b) => b !== gitInfo.branch && b.toLowerCase().includes(lowerSearch))
    : []
  const trimmed = search.trim()
  const normalizedTrimmed = trimmed.toLowerCase()
  const currentBranchLower = gitInfo?.branch.toLowerCase()
  const canCreate = trimmed.length > 0
    && normalizedTrimmed !== currentBranchLower
    && !branches.some((b) => b.toLowerCase() === normalizedTrimmed)

  return (
    <>
      {gitInfo && (
        <>
          <div className="h-3 w-px bg-border" />
          <Popover open={popoverOpen} onOpenChange={openPopover}>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
                title={gitInfo.branch}
              >
                <GitBranch className="size-3" />
                {!compact && <span>{gitInfo.branch}</span>}
                {dirty && <Circle className="size-1.5 fill-amber-500 text-amber-500" />}
                {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />}
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
                  {currentMatch && gitInfo && (
                    <CommandGroup>
                      <CommandItem
                        value={gitInfo.branch}
                        onSelect={() => void handleBranchSelect(gitInfo.branch)}
                        className="gap-2 text-xs"
                      >
                        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{gitInfo.branch}</span>
                          {dirty && (
                            <span className="text-xs text-muted-foreground">
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
                        <Check className="size-3 shrink-0 text-primary" />
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
                            onSelect={() => void handleBranchSelect(b)}
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
                          onSelect={() => void doCreateBranch(trimmed)}
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

      {isGitRepo === false && (
        <>
          <div className="h-3 w-px bg-border" />
          <button
            onClick={() => void handleGitInit()}
            disabled={initing}
            className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title={t('chat.git.initHint')}
          >
            <GitBranchPlus className="size-3" />
            {!compact && <span>{t('chat.git.init')}</span>}
          </button>
        </>
      )}

      {gitError && (
        <>
          <div className="h-3 w-px bg-border" />
          <button
            onClick={() => void refreshGitInfo()}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-warning transition-colors hover:bg-muted"
            title={t('chat.git.unavailableHint', { error: gitError })}
          >
            <TriangleAlert className="size-3" />
            {!compact && <span>{t('chat.git.unavailable')}</span>}
          </button>
        </>
      )}

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

