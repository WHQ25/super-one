import { useEffect, useMemo, useRef } from 'react'
import { MessageSquare, Sparkles } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { getToolDisplay, getToolVerb } from './tool-display'
import { ToolIcon } from './ToolIcon'
import type { SubagentColorClasses } from './subagent-colors'
import type { JsonlEntry } from './subagent-utils'

/** Scrollable container that auto-scrolls to bottom on new content, unless user scrolled up. */
export function SubagentScrollArea({ children, borderClass, maxHeightClass = 'max-h-[100px]' }: {
  children: React.ReactNode
  borderClass: string
  maxHeightClass?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = (): void => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  })

  return (
    <div ref={scrollRef} className={cn('overflow-y-auto border-l-2 ml-3 pl-2.5 py-1', maxHeightClass, borderClass)}>
      {children}
    </div>
  )
}

/** Single tool row for an async subagent (no input/result, just name + summary). */
export function AsyncToolRow({ toolName, description, isActive }: { toolName: string; description: string; isActive: boolean }) {
  const icon = getToolDisplay(toolName, {}).icon
  return (
    <div className="tool-node my-0.5 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs">
      <ToolIcon icon={icon} className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium text-foreground">
        {isActive ? <>{getToolVerb(toolName)}&hellip;</> : toolName}
      </span>
      {description && <span className="min-w-0 truncate text-muted-foreground">{description}</span>}
    </div>
  )
}

/** Async subagent activity — JSONL entries (text + tool interleaved), with live fallback. */
export function AgentActivity({ entries, fallbackTools, activeTool, isRunning, summary, colors }: {
  entries: JsonlEntry[]
  fallbackTools?: Array<{ toolName: string; description: string }>
  activeTool?: { toolName: string; description: string }
  isRunning: boolean
  summary?: string
  colors: SubagentColorClasses
}) {
  const latestActivity = useMemo(
    () => entries.findLast((e) => e.type === 'activity') as { type: 'activity'; text: string } | undefined,
    [entries],
  )
  const tools = useMemo(
    () => entries.filter((e): e is JsonlEntry & { type: 'tool' } => e.type === 'tool'),
    [entries],
  )
  return (
    <div className="border-t border-border/30">
      {summary && (
        <div className="mx-2.5 mt-1.5 mb-1.5 flex items-start gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-foreground dark:bg-blue-900/20">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="whitespace-pre-wrap">{summary}</span>
        </div>
      )}
      {isRunning && latestActivity && (
        <div className={cn('mx-2.5 mt-1.5 mb-1.5 flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs leading-relaxed text-foreground', colors.activityBg)}>
          <MessageSquare className={cn('mt-0.5 size-3 shrink-0 animate-pulse', colors.text)} />
          <span className="whitespace-pre-wrap">{latestActivity.text.trim()}</span>
        </div>
      )}
      <SubagentScrollArea borderClass={colors.borderL}>
        {(tools.length > 0 ? tools : fallbackTools ?? []).map((entry, i) => (
          <AsyncToolRow key={i} toolName={entry.toolName} description={entry.description} isActive={false} />
        ))}
        {activeTool && (
          <AsyncToolRow toolName={activeTool.toolName} description={activeTool.description} isActive />
        )}
      </SubagentScrollArea>
    </div>
  )
}
