import { Loader2 } from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay, parseToolInput } from './tool-display'

interface ToolBlockProps {
  toolName: string
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
}

export function ToolBlock({ toolName, input, status, elapsedSeconds }: ToolBlockProps) {
  const params = parseToolInput(input)
  const display = getToolDisplay(toolName, params)
  const isStreaming = status === 'streaming'

  // For unknown tools, show truncated raw input as fallback
  const summary = display.summary || (display.icon === 'wrench' && input.length > 0
    ? (input.length > 80 ? input.slice(0, 80) + '\u2026' : input)
    : '')

  return (
    <div className="my-1 flex items-center gap-1.5 rounded bg-neutral-700/50 px-2 py-1.5 text-xs">
      {isStreaming ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />
      ) : (
        <ToolIcon icon={display.icon} className="size-3 shrink-0 text-neutral-400" />
      )}
      <span className="font-medium text-neutral-300">{toolName}</span>
      {summary && (
        <span className="min-w-0 truncate text-neutral-500">{summary}</span>
      )}
      {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
        <span className="ml-auto shrink-0 text-neutral-500">{Math.round(elapsedSeconds)}s</span>
      )}
    </div>
  )
}
