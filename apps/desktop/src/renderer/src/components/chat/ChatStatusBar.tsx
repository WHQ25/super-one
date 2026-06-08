import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GitBranch, GitBranchPlus, ChevronDown, Check, Circle, Plus, SquareTerminal, Bot } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
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
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { StatusBarPermission } from './chat-status-bar/StatusBarPermission'
import { StatusBarSandbox } from './chat-status-bar/StatusBarSandbox'
import { WorkDirIndicator } from './WorkDirIndicator'
import { parseToolInput } from './tool-display'
import { ToolBlock } from './ToolBlock'
import { SubagentBlock } from './SubagentBlock'
import type { ContentBlock, GitInfo } from '@superone/shared/agent-types'

interface WorktreeStateLike {
  pendingBaseBranch: string | null
  activePath: string | null
}

export function computeIsInWorktree(wtState: WorktreeStateLike | undefined): boolean {
  return !!(wtState?.pendingBaseBranch || wtState?.activePath)
}

const fmt = (n: number) => n.toLocaleString()

interface FailedCheckout {
  branch: string
  error: string
}

export type BackgroundActivityItem =
  | {
      id: string
      kind: 'bash'
      title: string
      toolUse: ContentBlock & { type: 'tool_use' }
      result?: ContentBlock & { type: 'tool_result' }
    }
  | {
      id: string
      kind: 'agent'
      title: string
      taskBlock: ContentBlock & { type: 'tool_use' }
      childBlocks: ContentBlock[]
      resultBlock?: ContentBlock & { type: 'tool_result' }
    }

type TaskProgress = Record<string, { description: string; completed?: boolean; [k: string]: unknown }>

export function collectBackgroundActivities(
  messages: Array<{ content: ContentBlock[] }>,
  taskProgress: TaskProgress,
): { bashActivities: Extract<BackgroundActivityItem, { kind: 'bash' }>[]; agentActivities: Extract<BackgroundActivityItem, { kind: 'agent' }>[] } {
  const results = new Map<string, ContentBlock & { type: 'tool_result' }>()
  const children = new Map<string, ContentBlock[]>()
  const bashActivities: Extract<BackgroundActivityItem, { kind: 'bash' }>[] = []
  const agentActivities: Extract<BackgroundActivityItem, { kind: 'agent' }>[] = []

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        results.set(block.toolUseId, block)
      }
      const parentId = 'parentToolUseId' in block ? block.parentToolUseId : null
      if (parentId) {
        const next = children.get(parentId) ?? []
        next.push(block)
        children.set(parentId, next)
      }
    }
  }

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue

      if (block.toolName === 'Bash') {
        const params = parseToolInput(block.input, block.toolName)
        const result = results.get(block.toolUseId)
        const progress = taskProgress[block.toolUseId]
        const runInBackground = params.run_in_background === true || params.background === true
        const hasTaskState = !!progress
        const isStreamingTool = block.status === 'streaming'
        const hasBackgroundSignal = runInBackground || !!result?.outputPath
        const isRunning = hasTaskState ? progress.completed !== true : (runInBackground && isStreamingTool)
        if (!hasBackgroundSignal || !isRunning) continue

        const command = typeof params.command === 'string' ? params.command.trim() : ''
        bashActivities.push({
          id: block.toolUseId,
          kind: 'bash',
          title: command || 'Bash',
          toolUse: block,
          result,
        })
        continue
      }

      if (block.toolName === 'Agent') {
        const params = parseToolInput(block.input, block.toolName)
        if (params.run_in_background !== true) continue
        const progress = taskProgress[block.toolUseId]
        const hasTaskState = !!progress
        const isRunning = hasTaskState ? progress.completed !== true : block.status === 'streaming'
        if (!isRunning) continue
        const resultBlock = results.get(block.toolUseId)
        const childBlocks = children.get(block.toolUseId) ?? []
        const title = String(params.description ?? params.name ?? params.subagent_type ?? 'Async Agent').trim() || 'Async Agent'
        agentActivities.push({
          id: block.toolUseId,
          kind: 'agent',
          title,
          taskBlock: block,
          childBlocks,
          resultBlock,
        })
      }
    }
  }

  return { bashActivities, agentActivities }
}

export function ChatStatusBar() {
  const { t } = useTranslation()
  const barRef = useRef<HTMLDivElement>(null)
  const fullModeRequiredWidthRef = useRef(0)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const worktrees = useAppStore((s) => s._worktrees)
  const messages = useActiveSession((s) => s.messages)
  const sessionStatus = useActiveSession((s) => s.status)
  const taskProgress = useActiveSession((s) => s.taskProgress)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const activeProvider = sessionProvider ?? preferredProvider
  const [compactIndicators, setCompactIndicators] = useState(false)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
  const [initing, setIniting] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [bashOpen, setBashOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [failedCheckout, setFailedCheckout] = useState<FailedCheckout | null>(null)
  const dirty = gitInfo?.dirty

  const worktreeBaseBranch = useActiveSession((s) => s._worktreeBaseBranch)
  const wtState = currentFolder ? worktrees[currentFolder] : undefined
  const isInWorktree = computeIsInWorktree(wtState)

  const refreshGitInfo = useCallback(async () => {
    if (!currentFolder) return
    const [info, repo] = await Promise.all([
      window.app.getGitInfo(currentFolder),
      window.app.getGitIsRepo(currentFolder),
    ])
    if (info) setGitInfo(info)
    setIsGitRepo(repo)
  }, [currentFolder])

  useEffect(() => {
    if (!currentFolder) { setGitInfo(null); setIsGitRepo(null); return }

    let cancelled = false
    const fetch = () => {
      window.app.getGitInfo(currentFolder).then((info) => {
        if (!cancelled) setGitInfo(info)
      })
      window.app.getGitIsRepo(currentFolder).then((repo) => {
        if (!cancelled) setIsGitRepo(repo)
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

  const updateCompactState = useCallback(() => {
    const node = barRef.current
    if (!node) return
    const availableWidth = node.clientWidth

    if (!compactIndicators) {
      const requiredWidth = node.scrollWidth
      fullModeRequiredWidthRef.current = requiredWidth
      if (requiredWidth > availableWidth + 1) {
        setCompactIndicators(true)
      }
      return
    }

    if (availableWidth >= fullModeRequiredWidthRef.current + 1) {
      setCompactIndicators(false)
    }
  }, [compactIndicators])

  useEffect(() => {
    const node = barRef.current
    if (!node) return
    let rafId = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateCompactState)
    })
    observer.observe(node)
    return () => { cancelAnimationFrame(rafId); observer.disconnect() }
  }, [updateCompactState])

  useEffect(() => {
    updateCompactState()
  }, [
    updateCompactState,
    gitInfo?.branch,
    dirty?.files,
    dirty?.insertions,
    dirty?.deletions,
    activeProvider,
    worktreeBaseBranch,
    wtState?.pendingBaseBranch,
    wtState?.activePath,
    isGitRepo,
  ])

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

  const handleGitInit = useCallback(async () => {
    if (!currentFolder || initing) return
    setIniting(true)
    const result = await window.app.gitInit(currentFolder)
    setIniting(false)
    if (result.ok) {
      toast.success(t('chat.git.initSuccess'))
      setIsGitRepo(true)
      await refreshGitInfo()
    } else {
      toast.error(t('chat.git.initFailed', { error: result.error ?? '' }))
    }
  }, [currentFolder, initing, refreshGitInfo, t])

  const lowerSearch = search.toLowerCase()
  const currentMatch = gitInfo?.branch.toLowerCase().includes(lowerSearch)
  const otherBranches = branches.filter((b) => b !== gitInfo?.branch && b.toLowerCase().includes(lowerSearch))
  const trimmed = search.trim()
  const normalizedTrimmed = trimmed.toLowerCase()
  const currentBranchLower = gitInfo?.branch.toLowerCase()
  const canCreate = trimmed.length > 0
    && normalizedTrimmed !== currentBranchLower
    && !branches.some((b) => b.toLowerCase() === normalizedTrimmed)

  const { bashActivities, agentActivities } = useMemo(
    () => collectBackgroundActivities(messages, taskProgress),
    [messages, taskProgress],
  )
  const bashLabel = bashActivities.length > 1 ? `${bashActivities.length} Bashes` : 'Bash'
  const agentLabel = agentActivities.length > 1 ? `${agentActivities.length} Agents` : 'Agent'
  const bashPanelTitle = `Background ${bashActivities.length > 1 ? 'Bashes' : 'Bash'}`
  const agentPanelTitle = `Background ${agentActivities.length > 1 ? 'Agents' : 'Agent'}`

  useEffect(() => {
    if (bashActivities.length === 0) setBashOpen(false)
  }, [bashActivities.length])

  useEffect(() => {
    if (agentActivities.length === 0) setAgentOpen(false)
  }, [agentActivities.length])

  return (
    <>
      <div ref={barRef} className="relative flex items-center gap-2 whitespace-nowrap px-3 pb-1 pt-0.5 @lg:px-7 text-[11px] text-muted-foreground">
        <div className="pointer-events-none absolute bottom-full left-3 right-3 z-10 flex flex-col gap-1 pb-1">
          <AnimatePresence>
            {bashOpen && bashActivities.length > 0 && (
              <motion.div
                key="bash-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-card shadow-md"
              >
                <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground">{bashPanelTitle}</div>
                <div className="activity-panel max-h-[50vh] divide-y divide-border overflow-y-auto p-1.5">
                  {bashActivities.map((item, i) => (
                    <ToolBlock
                      key={item.id}
                      toolName="Bash"
                      toolUseId={item.toolUse.toolUseId}
                      input={item.toolUse.input}
                      status={item.toolUse.status}
                      elapsedSeconds={item.toolUse.elapsedSeconds}
                      result={item.result?.summary}
                      isTimedOut={item.result?.isTimedOut}
                      resultOutputPath={item.result?.outputPath}
                      autoExpand={i === 0}
                      backgroundActivity
                    />
                  ))}
                </div>
              </motion.div>
            )}
            {agentOpen && agentActivities.length > 0 && (
              <motion.div
                key="agent-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-card shadow-md"
              >
                <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground">{agentPanelTitle}</div>
                <div className="activity-panel max-h-[50vh] divide-y divide-border overflow-y-auto p-1.5">
                  {agentActivities.map((item, i) => (
                    <SubagentBlock
                      key={item.id}
                      taskBlock={item.taskBlock}
                      childBlocks={item.childBlocks}
                      resultBlock={item.resultBlock}
                      isStreaming={sessionStatus === 'streaming'}
                      defaultExpanded={i === 0}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {currentFolder && <WorkDirIndicator compact={compactIndicators} isGitRepo={isGitRepo} />}

        {gitInfo && !isInWorktree && !worktreeBaseBranch && (
          <>
            <div className="h-3 w-px bg-border" />
            <Popover open={popoverOpen} onOpenChange={openPopover}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
                  title={gitInfo.branch}
                >
                  <GitBranch className="size-3" />
                  {!compactIndicators && <span>{gitInfo.branch}</span>}
                  {dirty && <Circle className="size-1.5 fill-amber-500 text-amber-500" />}
                  {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`} />}
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

        {isGitRepo === false && !isInWorktree && !worktreeBaseBranch && (
          <>
            <div className="h-3 w-px bg-border" />
            <button
              onClick={handleGitInit}
              disabled={initing}
              className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              title={t('chat.git.initHint')}
            >
              <GitBranchPlus className="size-3" />
              {!compactIndicators && <span>{t('chat.git.init')}</span>}
            </button>
          </>
        )}

        <div className="h-3 w-px bg-border" />

        <StatusBarPermission activeProvider={activeProvider} compactIndicators={compactIndicators} />

        <div className="flex-1" />

        {bashActivities.length > 0 && (
          <button
            onClick={() => setBashOpen((o) => !o)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
            title={bashActivities.length > 1 ? `${bashActivities.length} Bashes` : 'Bash'}
          >
            <SquareTerminal className="size-3 animate-pulse" />
            {!compactIndicators && <span>{bashLabel}</span>}
            {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${bashOpen ? 'rotate-180' : ''}`} />}
          </button>
        )}

        {agentActivities.length > 0 && (
          <>
            {bashActivities.length > 0 && <div className="h-3 w-px bg-border" />}
            <button
              onClick={() => setAgentOpen((o) => !o)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
              title={agentLabel}
            >
              <Bot className="size-3 animate-pulse" />
              {!compactIndicators && <span>{agentLabel}</span>}
              {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${agentOpen ? 'rotate-180' : ''}`} />}
            </button>
          </>
        )}

        <StatusBarSandbox
          activeProvider={activeProvider}
          compactIndicators={compactIndicators}
          showDivider={bashActivities.length > 0 || agentActivities.length > 0}
        />
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
