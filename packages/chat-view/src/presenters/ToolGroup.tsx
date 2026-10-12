import { useTranscriptState } from '@superone/ui/lib/transcript-state'
import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronRight, BookOpenText } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ContentBlock } from '@superone/shared/agent-types'
import { codexCommandPresentation, parsedCommandFromBashInput } from '@superone/shared/codex-command-actions'

export type ToolGroupToolUse = Extract<ContentBlock, { type: 'tool_use' }>

export interface ToolGroupPresenterProps {
  blocks: ContentBlock[]
  sealed?: boolean
  getToolVerb(toolName: string): string
  renderTool(block: ToolGroupToolUse, index: number): ReactNode
}

/** Collapsible group for consecutive read-only tool calls (Read, Glob, Grep, read-only parsed commands). */
export function ToolGroupPresenter({
  blocks,
  sealed = false,
  getToolVerb,
  renderTool,
}: ToolGroupPresenterProps) {
  const toolUses = blocks.filter((b) => b.type === 'tool_use')
  const hasStreamingTool = toolUses.some((b) => b.type === 'tool_use' && b.status === 'streaming')
  const [expanded, setExpanded] = useTranscriptState(`tool-group-${toolUses[0]?.toolUseId ?? ''}`, hasStreamingTool && !sealed)
  const wasSealed = useRef(sealed)

  const summary = generateToolGroupSummary(toolUses)
  const streamingTool = hasStreamingTool
    ? toolUses.find((b) => b.type === 'tool_use' && b.status === 'streaming')
    : null

  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    if (sealed && !wasSealed.current) setExpanded(false)
    wasSealed.current = sealed
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
        <div ref={scrollRef} className="mt-0.5 max-h-30 space-y-0.5 overflow-y-auto pl-2">
          {blocks.map((block, i) => {
            if (block.type === 'tool_use') {
              return renderTool(block, i)
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
          {renderTool(streamingTool, -1)}
        </div>
      )}
    </div>
  )
}

const ACTION_TOOL: Record<string, string> = { read: 'Read', search: 'Grep', listFiles: 'LS' }

export function generateToolGroupSummary(toolUses: ContentBlock[]): string {
  const counts: Record<string, number> = {}
  const add = (name: string, count = 1) => { counts[name] = (counts[name] || 0) + count }
  // Parsed commands count each file once, however many of them read it.
  const commandFiles = new Set<string>()
  for (const t of toolUses) {
    if (t.type !== 'tool_use') continue
    // A parsed command counts what it did: each file read, search and listing.
    const command = t.toolName === 'Bash' ? parsedCommandFromBashInput(t.toolUseId, t.input) : null
    if (!command) { add(t.toolName); continue }
    const view = codexCommandPresentation(command)
    // Holds the label's place where the first file was read.
    if (view.files.length) counts.Read ??= 0
    for (const file of view.files) commandFiles.add(file)
    for (const action of view.actions) if (action.type !== 'read') add(ACTION_TOOL[action.type] ?? 'Bash')
  }
  if (commandFiles.size) add('Read', commandFiles.size)

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
      case 'LS': parts.push(`listed ${count} folder${p ? 's' : ''}`); break
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
