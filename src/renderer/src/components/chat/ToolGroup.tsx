import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolBlock } from './ToolBlock'
import type { ContentBlock } from '../../../../shared/agent-types'

interface ToolGroupProps {
  blocks: ContentBlock[]
  isStreaming: boolean
}

/** Collapsible group for consecutive read-only tool calls (Read, Glob, Grep). */
export function ToolGroup({ blocks }: ToolGroupProps) {
  const toolUses = blocks.filter((b) => b.type === 'tool_use')
  const hasStreamingTool = toolUses.some((b) => b.type === 'tool_use' && b.status === 'streaming')
  const [expanded, setExpanded] = useState(hasStreamingTool)

  const summary = generateSummary(toolUses)
  const streamingTool = hasStreamingTool
    ? toolUses.find((b) => b.type === 'tool_use' && b.status === 'streaming')
    : null

  return (
    <div className="tool-group my-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70"
      >
        <ChevronRight
          className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')}
        />
        {hasStreamingTool && (
          <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />
        )}
        <span className="text-foreground">{summary}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{toolUses.length} tool use</span>
      </button>

      {expanded && (
        <div className="mt-0.5 space-y-0.5 pl-2">
          {blocks.map((block, i) => {
            if (block.type === 'tool_use') {
              return (
                <ToolBlock key={i} toolName={block.toolName} input={block.input} status={block.status} elapsedSeconds={block.elapsedSeconds} />
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
          <ToolBlock toolName={streamingTool.toolName} input={streamingTool.input} status={streamingTool.status} elapsedSeconds={streamingTool.elapsedSeconds} />
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
  return parts.join(', ')
}
