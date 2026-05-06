import { useState, useEffect, useRef, useMemo } from 'react'
import { Bot, ChevronRight, Check, Loader2, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import type { CodexCollabToolCallItem, CodexThreadItem } from '@superone/shared/agent-types'
import { renderCodexItem } from './codex-item-renderer'
import { streamdownPlugins, streamdownRehypePlugins, streamdownControls, streamdownComponents, streamdownLinkSafety } from './chat-shared'

const TOOL_LABEL: Record<string, string> = {
  spawnAgent: 'Task',
  sendInput: 'Follow-up',
  resumeAgent: 'Resume',
  wait: 'Wait',
  closeAgent: 'Close',
}

function getAgentDisplay(items: CodexCollabToolCallItem[]): { name: string; role?: string } {
  for (const item of items) {
    for (const state of Object.values(item.agentsStates)) {
      if (state.nickname) return { name: state.nickname, role: state.role }
    }
  }
  return { name: 'Subagent' }
}

function resolveStatus(items: CodexCollabToolCallItem[], isStreaming: boolean) {
  if (isStreaming && items.some((i) => i.status === 'in_progress')) return 'running' as const
  const allStates = items.flatMap((i) => Object.values(i.agentsStates))
  if (allStates.some((s) => s.status === 'errored')) return 'errored' as const
  if (items.every((i) => i.status === 'completed')) return 'completed' as const
  return 'running' as const
}

interface ChatTurn {
  prompt?: string
  label: string
  items: CodexThreadItem[]
}

function buildChatTurns(collabItems: CodexCollabToolCallItem[]): ChatTurn[] {
  return collabItems.map((item) => {
    const allItems: CodexThreadItem[] = []
    const seen = new Set<string>()
    for (const tid of item.receiverThreadIds) {
      seen.add(tid)
      if (item.childItems?.[tid]) allItems.push(...item.childItems[tid])
    }
    if (item.childItems) {
      for (const [tid, threadItems] of Object.entries(item.childItems)) {
        if (!seen.has(tid)) allItems.push(...threadItems)
      }
    }
    return { prompt: item.prompt, label: TOOL_LABEL[item.tool] ?? item.tool, items: allItems }
  })
}

function separateOutput(turns: ChatTurn[]): { turns: ChatTurn[]; output?: string } {
  if (turns.length === 0) return { turns }
  const last = turns[turns.length - 1]
  const idx = last.items.findLastIndex((i) => i.type === 'agent_message')
  if (idx === -1) return { turns }
  const msg = last.items[idx]
  if (msg.type !== 'agent_message') return { turns }
  return {
    turns: [...turns.slice(0, -1), { ...last, items: last.items.filter((_, i) => i !== idx) }],
    output: msg.text,
  }
}

function countItems(turns: ChatTurn[]): number {
  return turns.reduce((sum, t) => sum + t.items.length, 0)
}

function PromptPreview({ prompt, label }: { prompt: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-3 py-1.5 text-[11px]">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((s) => !s) }}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-[100px] overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 text-muted-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

function CollabScrollArea({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div
      ref={scrollRef}
      className="max-h-[100px] overflow-y-auto border-l-2 border-purple-500/30 ml-3 pl-2.5 py-1"
    >
      {children}
    </div>
  )
}

function OutputPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-border/30 px-3 py-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((s) => !s) }}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        <span className="font-medium">Output</span>
      </button>
      {open && (
        <div className="mt-1 max-h-[200px] overflow-y-auto text-xs">
          <Streamdown
            className="chat-md"
            plugins={streamdownPlugins}
            rehypePlugins={streamdownRehypePlugins}
            components={streamdownComponents}
            controls={streamdownControls}
            linkSafety={streamdownLinkSafety}
          >
            {text}
          </Streamdown>
        </div>
      )}
    </div>
  )
}

export function CodexCollabBlock({ items, isStreaming }: { items: CodexCollabToolCallItem[]; isStreaming: boolean }) {
  const { name, role } = useMemo(() => getAgentDisplay(items), [items])
  const status = useMemo(() => resolveStatus(items, isStreaming), [items, isStreaming])
  const isRunning = status === 'running'
  const isComplete = status === 'completed'
  const [expanded, setExpanded] = useState(isRunning || !isComplete)

  useEffect(() => {
    if (isRunning) setExpanded(true)
  }, [isRunning])

  const allTurns = useMemo(() => buildChatTurns(items), [items])
  const { turns, output } = useMemo(
    () => (isComplete ? separateOutput(allTurns) : { turns: allTurns, output: undefined }),
    [allTurns, isComplete],
  )
  const hasContent = useMemo(() => turns.some((t) => t.prompt || t.items.length > 0), [turns])
  const firstPrompt = turns[0]?.prompt
  const firstLabel = turns[0]?.label ?? 'Prompt'
  const itemCount = useMemo(() => countItems(turns), [turns])

  return (
    <div className="subagent-container my-1 min-w-0 overflow-hidden rounded border border-border/50 bg-muted/20">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
      >
        <ChevronRight className={cn('mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
        <Bot className="mt-0.5 size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
        <span className="font-medium text-foreground">{name}</span>
        {role && (
          <span className="mt-px shrink-0 rounded bg-purple-500/15 px-1 py-px text-[10px] text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
            {role}
          </span>
        )}
        {!role && name === 'Subagent' && (
          <span className="min-w-0 truncate text-left text-muted-foreground">Spawning subagent...</span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/30"
          >
            {firstPrompt && <PromptPreview prompt={firstPrompt} label={firstLabel} />}

            <CollabScrollArea>
              {turns.map((turn, ti) => (
                <div key={ti}>
                  {ti > 0 && turn.prompt && (
                    <div className="my-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-medium">{turn.label}</span>
                      <span className="min-w-0 truncate">{turn.prompt.slice(0, 80)}{turn.prompt.length > 80 ? '…' : ''}</span>
                    </div>
                  )}
                  {turn.items.map((item, i) =>
                    renderCodexItem(item, i, isStreaming && ti === turns.length - 1, turn.items[i + 1]),
                  )}
                </div>
              ))}
            </CollabScrollArea>

            {output && <OutputPreview text={output} />}
          </motion.div>
        )}
      </AnimatePresence>

      {expanded && (isRunning || isComplete || status === 'errored') && (
        <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {isRunning ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              <span>Running</span>
            </>
          ) : status === 'errored' ? (
            <>
              <span className="size-2 rounded-full bg-red-600 dark:bg-red-400" />
              <span>Errored</span>
            </>
          ) : (
            <>
              <Check className="size-3 shrink-0 text-green-600 dark:text-green-400" />
              <span>Done</span>
            </>
          )}
          {itemCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-0.5">
              <Wrench className="size-3" />
              {itemCount}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
