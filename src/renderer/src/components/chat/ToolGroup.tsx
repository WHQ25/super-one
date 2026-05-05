import { useState, useEffect, useRef } from 'react'
import { ChevronRight, BookOpenText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolBlock } from './ToolBlock'
import { getToolVerb } from './tool-display'
import type { ContentBlock } from '../../../../shared/agent-types'

interface ToolGroupProps {
  blocks: ContentBlock[]
  sealed?: boolean
}

/** Collapsible group for consecutive read-only tool calls (Read, Glob, Grep). */
export function ToolGroup({ blocks, sealed = false }: ToolGroupProps) {
  const toolUses = blocks.filter((b) => b.type === 'tool_use')
  const hasStreamingTool = toolUses.some((b) => b.type === 'tool_use' && b.status === 'streaming')
  const [expanded, setExpanded] = useState(hasStreamingTool && !sealed)

  const summary = generateSummary(toolUses)
  const streamingTool = hasStreamingTool
    ? toolUses.find((b) => b.type === 'tool_use' && b.status === 'streaming')
    : null

  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    if (sealed) setExpanded(false)
  }, [sealed])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    isNearBottomRef.current = true
    const handleScroll = (): void => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [expanded])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  })

  return (
    <div className="tool-group my-0.5">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70"
      >
        <BookOpenText className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-foreground">
          {hasStreamingTool && streamingTool?.type === 'tool_use'
            ? <>{getToolVerb(streamingTool.toolName)}…</>
            : summary}
        </span>
        <ChevronRight
          className={cn('ml-auto size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div ref={scrollRef} className="mt-0.5 max-h-[120px] space-y-0.5 overflow-y-auto pl-2">
          {blocks.map((block, i) => {
            if (block.type === 'tool_use') {
              return (
                <ToolBlock key={i} toolName={block.toolName} toolUseId={block.toolUseId} input={block.input} status={block.status} elapsedSeconds={block.elapsedSeconds} />
              )
            }
            if (block.type === 'tool_result') {
              return null
            }
            return null
          })}
        </div>
      )}

      {!expanded && streamingTool && streamingTool.type === 'tool_use' && (
        <div className="mt-0.5">
          <ToolBlock toolName={streamingTool.toolName} toolUseId={streamingTool.toolUseId} input={streamingTool.input} status={streamingTool.status} elapsedSeconds={streamingTool.elapsedSeconds} />
        </div>
      )}
    </div>
  )
}

function generateSummary(toolUses: ContentBlock[]): string {
  const counts: Record<string, number> = {}
  for (const t of toolUses) {
    if (t.type === 'tool_use') counts[t.toolName] = (counts[t.toolName] || 0) + 1
  }

  const globCount = counts['Glob'] ?? 0
  const grepCount = counts['Grep'] ?? 0
  const parts: string[] = []
  for (const [name, count] of Object.entries(counts)) {
    if (name === 'Glob' || name === 'Grep') continue
    const p = count > 1
    switch (name) {
      case 'Read': parts.push(`read ${count} file${p ? 's' : ''}`); break
      case 'WebSearch': parts.push(`${count} web search${p ? 'es' : ''}`); break
      case 'WebFetch': parts.push(`fetched ${count} page${p ? 's' : ''}`); break
      default: parts.push(`${name} \u00d7${count}`)
    }
  }
  if (globCount > 0 || grepCount > 0) {
    const sub: string[] = []
    if (globCount > 0) sub.push(`${globCount} pattern${globCount > 1 ? 's' : ''}`)
    if (grepCount > 0) sub.push(`${grepCount} code`)
    parts.push(`searched ${sub.join(' · ')}`)
  }
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
