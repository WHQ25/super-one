import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronRight, Check, Loader2, Wrench, Terminal, FileEdit, Search, ArrowUp, ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import type { CodexCollabToolCallItem, CodexCollabTool, CodexThreadItem } from '@superone/shared/agent-types'
import { streamdownPlugins, streamdownRehypePlugins, streamdownControls, streamdownComponents, streamdownLinkSafety, formatTokens } from './chat-shared'
import { NestedToolContext } from './nested-tool-context'
import { useForkNavigation } from './fork-navigation-context'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { getSubagentColorClasses } from './subagent-colors'
import { CompactLabeledToolRow } from './tool-row'
import { isCodexCommandToolError } from './codex-command-status'
import {
  CodexCollabBlockPresenter,
  codexCollabViewModel,
} from './presenters/CodexCollabBlock'

export const TASK_CARD_ITEM_TYPES = new Set<CodexThreadItem['type']>([
  'command_execution',
  'mcp_tool_call',
  'file_change',
  'web_search',
])

function getAgentDisplay(items: CodexCollabToolCallItem[]): { name?: string; role?: string } {
  for (const item of items) {
    for (const state of Object.values(item.agentsStates)) {
      if (state.nickname) return { name: state.nickname, role: state.role }
    }
  }
  return {}
}

function resolveStatus(items: CodexCollabToolCallItem[], isStreaming: boolean) {
  const allStates = items.flatMap((i) => Object.values(i.agentsStates))
  if (items.some((i) => i.status === 'failed')) return 'errored' as const
  if (allStates.some((s) => s.status === 'errored')) return 'errored' as const
  if (isStreaming) return 'running' as const
  if (allStates.some((s) => s.status === 'running' || s.status === 'pendingInit')) return 'running' as const
  if (items.every((i) => i.status === 'completed')) return 'completed' as const
  return 'running' as const
}

interface ChatTurn {
  prompt?: string
  tool: CodexCollabTool
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
    return { prompt: item.prompt, tool: item.tool, items: allItems }
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

function filterTaskCardItems(turns: ChatTurn[]): ChatTurn[] {
  return turns.map((turn) => ({
    ...turn,
    items: turn.items.filter((item) => TASK_CARD_ITEM_TYPES.has(item.type)),
  }))
}

function aggregateAgentTokens(items: CodexCollabToolCallItem[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const item of items) {
    for (const state of Object.values(item.agentsStates)) {
      if (state.tokens) {
        input = Math.max(input, state.tokens.input)
        output = Math.max(output, state.tokens.output)
      }
    }
  }
  return { input, output }
}

function MiniToolChip({ item }: { item: CodexThreadItem }) {
  const { t } = useTranslation()
  if (item.type === 'command_execution') {
    return (
      <CompactLabeledToolRow
        icon={<Terminal className="size-3 shrink-0 text-muted-foreground" />}
        label={t('chat.codexCollab.miniTool.bash')}
        summary={item.command}
        streaming={item.status === 'in_progress'}
        tone={isCodexCommandToolError(item) ? 'error' : 'default'}
      />
    )
  }
  if (item.type === 'file_change') {
    const first = item.changes[0]
    return (
      <CompactLabeledToolRow
        icon={<FileEdit className="size-3 shrink-0 text-muted-foreground" />}
        label={t('chat.codexCollab.miniTool.edit')}
        summary={first?.path ?? t('chat.codexCollab.miniTool.filesFallback', { count: item.changes.length })}
        tone={item.status === 'failed' ? 'error' : 'default'}
      />
    )
  }
  if (item.type === 'mcp_tool_call') {
    return (
      <CompactLabeledToolRow
        icon={<Wrench className="size-3 shrink-0 text-muted-foreground" />}
        label={item.server}
        summary={item.tool.replace(/_/g, ' ')}
        streaming={item.status === 'in_progress'}
        tone={item.status === 'failed' || !!item.error ? 'error' : 'default'}
      />
    )
  }
  if (item.type === 'web_search') {
    return (
      <CompactLabeledToolRow
        icon={<Search className="size-3 shrink-0 text-muted-foreground" />}
        label={t('chat.codexCollab.miniTool.webSearch')}
        summary={item.query}
        streaming={item.status === 'in_progress'}
        tone={item.status === 'failed' ? 'error' : 'default'}
      />
    )
  }
  return null
}

function PromptPreview({ prompt, label }: { prompt: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-3 py-1.5 text-xs">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((s) => !s) }}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-25 overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 text-muted-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

function StatsCluster({ itemCount, tokens, hasTokens }: { itemCount: number; tokens: { input: number; output: number }; hasTokens: boolean }) {
  if (itemCount === 0 && !hasTokens) return null
  return (
    <>
      {itemCount > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Wrench className="size-3" />
          {itemCount}
        </span>
      )}
      {hasTokens && (
        <>
          {itemCount > 0 && <span>·</span>}
          {tokens.input > 0 && (
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <ArrowUp className="size-2.5" />
              {formatTokens(tokens.input)}
            </span>
          )}
          {tokens.output > 0 && (
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <ArrowDown className="size-2.5" />
              {formatTokens(tokens.output)}
            </span>
          )}
        </>
      )}
    </>
  )
}

function CollabScrollArea({ children, borderClass }: { children: React.ReactNode; borderClass: string }) {
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
      className={cn('max-h-25 overflow-y-auto border-l-2 ml-3 pl-2.5 py-1', borderClass)}
    >
      {children}
    </div>
  )
}

function OutputPreview({ text }: { text: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-border/30 px-3 py-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((s) => !s) }}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        <span className="font-medium">{t('chat.subagent.output')}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-50 overflow-y-auto text-xs">
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

interface CodexCollabBlockProps {
  items: CodexCollabToolCallItem[]
  isStreaming: boolean
  defaultExpanded?: boolean
}

export function CodexCollabBlock({
  items,
  isStreaming,
  defaultExpanded = false,
}: CodexCollabBlockProps) {
  const { t } = useTranslation()
  const { name: nickname, role } = useMemo(() => getAgentDisplay(items), [items])
  const status = useMemo(() => resolveStatus(items, isStreaming), [items, isStreaming])
  const isRunning = status === 'running'
  const isComplete = status === 'completed'
  const isErrored = status === 'errored'
  const [expanded, setExpanded] = useState(defaultExpanded)
  const name = nickname ?? t('chat.codexCollab.defaultName')

  const colorKey = items[0]?.receiverThreadIds[0] ?? items[0]?.id ?? ''
  useEffect(() => {
    if (colorKey) useChatStore.getState().assignSubagentColor(colorKey)
  }, [colorKey])
  const colorIdx = useActiveSession((s) => s.subagentColors[colorKey])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])

  const allTurns = useMemo(() => buildChatTurns(items), [items])
  const { turns, output } = useMemo(() => {
    const base = isComplete ? separateOutput(allTurns) : { turns: allTurns, output: undefined as string | undefined }
    return { turns: filterTaskCardItems(base.turns), output: base.output }
  }, [allTurns, isComplete])
  const hasContent = useMemo(() => turns.some((t) => t.prompt || t.items.length > 0), [turns])
  const firstPrompt = turns[0]?.prompt
  const firstTool = turns[0]?.tool
  const firstLabel = firstTool ? t(`chat.codexCollab.toolLabels.${firstTool}`) : t('chat.subagent.prompt')
  const itemCount = useMemo(() => countItems(turns), [turns])
  const tokens = useMemo(() => aggregateAgentTokens(items), [items])
  const hasTokens = tokens.input > 0 || tokens.output > 0

  return (
    <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
    <div className="subagent-container my-1 min-w-0 overflow-hidden rounded border border-border/50 bg-muted/20">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
      >
        <Bot className={cn('mt-0.5 size-3.5 shrink-0', colors.text, isRunning && !expanded && 'animate-pulse')} />
        <span className="font-medium text-foreground">{name}</span>
        {role && (
          <span className={cn('mt-px shrink-0 rounded px-1 py-px text-xs', colors.tagBg, colors.tagText)}>
            {role}
          </span>
        )}
        {!role && !nickname && !isErrored && (
          <span className="min-w-0 truncate text-left text-muted-foreground">
            {isRunning ? t('chat.subagent.spawning') : t('chat.codexCollab.defaultName')}
          </span>
        )}
        {isErrored && (
          <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-red-600 dark:text-red-400">
            <span className="size-2 rounded-full bg-red-600 dark:bg-red-400" />
            <span className="text-xs font-medium">{t('chat.codexCollab.failed')}</span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {!expanded && <StatsCluster itemCount={itemCount} tokens={tokens} hasTokens={hasTokens} />}
          <ChevronRight className={cn('mt-px size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-90')} />
        </span>
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

            <CollabScrollArea borderClass={colors.borderL}>
              {turns.map((turn, ti) => (
                <div key={ti}>
                  {ti > 0 && turn.prompt && (
                    <div className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium">{t(`chat.codexCollab.toolLabels.${turn.tool}`)}</span>
                      <span className="min-w-0 truncate">{turn.prompt.slice(0, 80)}{turn.prompt.length > 80 ? '…' : ''}</span>
                    </div>
                  )}
                  {turn.items.map((item, i) => (
                    <MiniToolChip key={`${item.id}-${i}`} item={item} />
                  ))}
                </div>
              ))}
            </CollabScrollArea>

            {output && <OutputPreview text={output} />}
          </motion.div>
        )}
      </AnimatePresence>

      {expanded && (isRunning || isComplete || status === 'errored') && (
        <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {isRunning ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              <span>{t('chat.subagent.running')}</span>
            </>
          ) : status === 'errored' ? (
            <>
              <span className="size-2 rounded-full bg-red-600 dark:bg-red-400" />
              <span>{t('chat.codexCollab.errored')}</span>
            </>
          ) : (
            <>
              <Check className="size-3 shrink-0 text-success" />
              <span>{t('chat.subagent.done')}</span>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <StatsCluster itemCount={itemCount} tokens={tokens} hasTokens={hasTokens} />
          </span>
        </div>
      )}
    </div>
    </NestedToolContext.Provider>
  )
}

export function isSubagentFollowUp(item: CodexCollabToolCallItem): boolean {
  return item.tool === 'sendInput' && item.receiverThreadIds.length > 0
}

export function isSpawnReady(item: CodexCollabToolCallItem): boolean {
  return item.receiverThreadIds.length > 0
}

function DesktopCollabMarkdown({ text }: { text: string }) {
  return (
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
  )
}

export function CodexSubagentMarker({ item }: { item: CodexCollabToolCallItem }) {
  const forkNav = useForkNavigation()
  const view = useMemo(() => codexCollabViewModel(item), [item])
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (view.colorKey) useChatStore.getState().assignSubagentColor(view.colorKey)
  }, [view.colorKey])
  const colorIdx = useActiveSession((s) => s.subagentColors[view.colorKey])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  return (
    <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
      <CodexCollabBlockPresenter
        item={item}
        colors={colors}
        expanded={expanded}
        onExpandedChange={setExpanded}
        canOpenFullView={Boolean(view.receiverId)}
        onOpenFullView={() => {
          if (view.receiverId) forkNav.open({ collabId: item.id, threadId: view.receiverId })
        }}
        childContent={view.activityItems.length > 0 ? (
          <CollabScrollArea borderClass={colors.borderL}>
            {view.activityItems.map((child, index) => (
              <MiniToolChip key={`${child.id}-${index}`} item={child} />
            ))}
          </CollabScrollArea>
        ) : undefined}
        formatTokens={formatTokens}
        Markdown={DesktopCollabMarkdown}
      />
    </NestedToolContext.Provider>
  )
}
