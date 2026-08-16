import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { MessageSquare, Sparkles } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import { uiToolNameFromId } from '@superone/shared/tool-ui'
import { getToolDisplay, getToolVerb } from './tool-display'
import { ToolIcon } from './ToolIcon'
import { ToolName, ToolSummary } from './tool-row'
import { ToolBlock } from './ToolBlock'
import { StructuredOutputBlock } from './StructuredOutputView'
import type { SubagentColorClasses } from './subagent-colors'
import type { JsonlEntry } from './subagent-utils'

function displayToolName(toolName: string): string {
  return uiToolNameFromId(toolName) ?? toolName
}
import {
  streamdownPlugins,
  streamdownRehypePlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
} from './chat-shared'

/** Scrollable container that auto-scrolls to bottom on new content, unless user scrolled up. */
export function SubagentScrollArea({ children, borderClass, maxHeightClass = 'max-h-25' }: {
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

/** Single tool row for live stubs only (no input/result yet). */
export function AsyncToolRow({ toolName, description, isActive }: { toolName: string; description: string; isActive: boolean }) {
  const name = displayToolName(toolName)
  const icon = getToolDisplay(name, {}).icon
  return (
    <div className="tool-node my-0.5 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs">
      <ToolIcon icon={icon} className="size-3 shrink-0 text-muted-foreground" />
      <ToolName streaming={isActive}>
        {isActive ? <>{getToolVerb(name)}&hellip;</> : name}
      </ToolName>
      {description ? <ToolSummary>{description}</ToolSummary> : null}
    </div>
  )
}

/**
 * Full-view / expanded transcript entry: ToolBlock when the JSONL parser kept
 * input (workflow agent history, completed JSONL), compact AsyncToolRow only
 * for live progress stubs that have name+description alone.
 *
 * Intentionally omits `toolUseId` on ToolBlock — child-session ids must not
 * collide with live parent-session store keys (_streamingToolInputPreviews,
 * toolRenderers). React keys still use the transcript id for stable identity.
 */
export function renderJsonlEntry(entry: JsonlEntry, index: number, isStreaming = false): ReactNode {
  if (entry.type === 'tool') {
    // Prefer full ToolBlock whenever we have structured input (even `{}`) so
    // workflow/subagent full views match the main Grok session tool UI.
    if (entry.input != null) {
      return (
        <ToolBlock
          key={entry.toolUseId ?? `tool-${index}`}
          toolName={entry.toolName}
          input={entry.input}
          status="complete"
          result={entry.result}
          isError={entry.isError}
          autoExpand={false}
        />
      )
    }
    return (
      <AsyncToolRow
        key={entry.toolUseId ?? `tool-${index}`}
        toolName={entry.toolName}
        description={entry.description}
        isActive={false}
      />
    )
  }
  if (entry.type === 'structured') {
    return <StructuredOutputBlock key={`structured-${index}`} data={entry.data} />
  }
  return (
    <Streamdown
      key={`activity-${index}`}
      className="chat-md text-xs"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      components={streamdownComponents}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
      isAnimating={isStreaming}
    >
      {entry.text}
    </Streamdown>
  )
}

/**
 * Inline expanded agent activity — same ToolBlock UI as main session / full view
 * when transcript entries carry input; compact AsyncToolRow only for live stubs
 * (progress lastToolName / name-only fallback before chat_history is available).
 */
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
  const useTranscriptTools = tools.length > 0
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
        {useTranscriptTools ? (
          // Prefer full ToolBlock (via renderJsonlEntry) so expand matches full-view /
          // main-session tool chrome once chat_history or agent JSONL is available.
          tools.map((entry, i) => renderJsonlEntry(entry, i, false))
        ) : (
          (fallbackTools ?? []).map((entry, i) => (
            <AsyncToolRow
              key={`${entry.toolName}-${i}-${entry.description}`}
              toolName={entry.toolName}
              description={entry.description}
              isActive={false}
            />
          ))
        )}
        {activeTool && (() => {
          if (useTranscriptTools) {
            const last = tools[tools.length - 1]
            // Avoid duplicating the live row when the transcript already has the current tool.
            if (last && last.toolName === activeTool.toolName) return null
            // Last tool may already be normalized (Read); active is raw (read_file).
            if (last && last.toolName.toLowerCase().replace(/[\s-]+/g, '_') === activeTool.toolName.toLowerCase().replace(/[\s-]+/g, '_')) {
              return null
            }
          } else {
            const list = fallbackTools ?? []
            const last = list[list.length - 1]
            if (last && last.toolName === activeTool.toolName && !activeTool.description) return null
          }
          return (
            <AsyncToolRow
              key={`active-${activeTool.toolName}`}
              toolName={activeTool.toolName}
              description={activeTool.description}
              isActive
            />
          )
        })()}
      </SubagentScrollArea>
    </div>
  )
}
