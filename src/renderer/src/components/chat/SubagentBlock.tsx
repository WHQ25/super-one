import { useState, useEffect, useRef } from 'react'
import { Bot, ChevronRight, Loader2, Check, BookOpen, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolBlock } from './ToolBlock'
import { parseToolInput } from './tool-display'
import { useChatStore } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'
import type { ContentBlock } from '../../../../shared/agent-types'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownControls = { table: false }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

interface SubagentBlockProps {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  isStreaming: boolean
}

/** Parse Task tool input to extract display info. */
function parseTaskInput(input: string) {
  const params = parseToolInput(input)
  return {
    name: String(params.name ?? ''),
    description: String(params.description ?? ''),
    subagentType: String(params.subagent_type ?? ''),
    prompt: String(params.prompt ?? ''),
    model: params.model ? String(params.model) : undefined,
  }
}

/** Format elapsed seconds to a readable string. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m${secs}s`
}

/** Format token count to a compact string. */
function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`
  return String(total)
}

/** Build a toolUseId → summary map for correlating tool_result with tool_use. */
function buildToolResultMap(blocks: ContentBlock[]) {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.summary) map.set(block.toolUseId, block.summary)
  }
  return map
}

export function SubagentBlock({ taskBlock, childBlocks, resultBlock, isStreaming }: SubagentBlockProps) {
  const totalTokens = useChatStore((s) => s.subagentTokens[taskBlock.toolUseId] ?? 0)
  const taskInput = parseTaskInput(taskBlock.input)
  const isRunning = !resultBlock && isStreaming
  const isComplete = !!resultBlock
  const isFromHistory = useRef(isComplete && totalTokens === 0)
  const [expanded, setExpanded] = useState(!isComplete)

  // Timer: count elapsed seconds while subagent is running
  const startTimeRef = useRef<number>(Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isRunning) return
    startTimeRef.current = Date.now() - elapsed * 1000
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  // Freeze elapsed on completion
  useEffect(() => {
    if (isComplete && elapsed === 0) {
      const maxElapsed = childBlocks.reduce((max, b) => {
        if (b.type === 'tool_use' && b.elapsedSeconds) return Math.max(max, b.elapsedSeconds)
        return max
      }, 0)
      if (maxElapsed > 0) setElapsed(Math.round(maxElapsed))
    }
  }, [isComplete])

  const toolResultMap = buildToolResultMap(childBlocks)
  const resultText = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
  const toolCallCount = childBlocks.filter((b) => b.type === 'tool_use').length
  const filesReadCount = childBlocks.filter((b) => b.type === 'tool_use' && b.toolName === 'Read').length

  return (
    <div className="subagent-container my-1 overflow-hidden rounded border border-border/50 bg-muted/20">
      {/* Header: Bot icon + subagent_type + description */}
      <button
        onClick={isFromHistory.current ? undefined : () => setExpanded((e) => !e)}
        className={cn('flex w-full items-start gap-2 px-2.5 py-2 text-xs transition-colors', !isFromHistory.current && 'hover:bg-muted/40')}
      >
        {!isFromHistory.current && (
          <ChevronRight
            className={cn('mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
          />
        )}
        <Bot className="mt-0.5 size-3.5 shrink-0 text-purple-400" />
        {taskInput.subagentType && (
          <span className="mt-px shrink-0 rounded bg-purple-900/40 px-1 py-px text-[10px] text-purple-300">
            {taskInput.subagentType}
          </span>
        )}
        {taskInput.description && (
          <span className="min-w-0 text-left text-muted-foreground">{taskInput.description}</span>
        )}
      </button>

      {/* Content — hidden for history-loaded subagents */}
      {!isFromHistory.current && expanded && (
        <div className="border-t border-border/30">
          {/* Input: prompt preview */}
          {taskInput.prompt && <PromptPreview prompt={taskInput.prompt} model={taskInput.model} />}

          {/* Sub tool calls — no grouping, scrollable */}
          {childBlocks.length > 0 && (
            <div className="max-h-[100px] overflow-y-auto border-l-2 border-purple-500/30 ml-3 pl-2.5 py-1">
              {childBlocks.map((block, i) =>
                renderChildBlock(block, i, isStreaming, toolResultMap)
              )}
            </div>
          )}

          {/* Output — collapsible with line limit */}
          {resultText && <OutputPreview text={resultText} />}
        </div>
      )}

      {/* Footer — hidden for history-loaded subagents */}
      {!isFromHistory.current && <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {isRunning ? (
          <>
            <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />
            <span>Running</span>
            {elapsed > 0 && <span className="tabular-nums">{formatElapsed(elapsed)}</span>}
          </>
        ) : isComplete ? (
          <>
            <Check className="size-3 shrink-0 text-green-400" />
            <span>Done{elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ''}</span>
            <span className="ml-auto flex items-center gap-1.5">
              {filesReadCount > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <BookOpen className="size-3" />
                  {filesReadCount}
                </span>
              )}
              {filesReadCount > 0 && toolCallCount > 0 && <span>·</span>}
              {toolCallCount > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Wrench className="size-3" />
                  {toolCallCount}
                </span>
              )}
              {totalTokens > 0 && (filesReadCount > 0 || toolCallCount > 0) && <span>·</span>}
              {totalTokens > 0 && <span>{formatTokens(totalTokens)} Tokens</span>}
            </span>
          </>
        ) : null}
      </div>}
    </div>
  )
}

/** Collapsible output with scrollable content. */
function OutputPreview({ text }: { text: string }) {
  const [showOutput, setShowOutput] = useState(false)

  return (
    <div className="border-t border-border/30 px-3 py-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setShowOutput((s) => !s) }}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', showOutput && 'rotate-90')} />
        <span className="font-medium">Output</span>
      </button>
      {showOutput && (
        <div className="mt-1 max-h-[200px] overflow-y-auto text-xs">
          <Streamdown
            className="chat-md"
            plugins={streamdownPlugins}
            components={streamdownComponents}
            controls={streamdownControls}
          >
            {text}
          </Streamdown>
        </div>
      )}
    </div>
  )
}

/** Collapsible prompt preview. */
function PromptPreview({ prompt, model }: { prompt: string; model?: string }) {
  const [showPrompt, setShowPrompt] = useState(false)

  return (
    <div className="px-3 py-1.5 text-[11px]">
      <button
        onClick={(e) => { e.stopPropagation(); setShowPrompt((s) => !s) }}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', showPrompt && 'rotate-90')} />
        <span>Prompt</span>
        {model && <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">{model}</span>}
      </button>
      {showPrompt && (
        <div className="mt-1 max-h-[100px] overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 text-muted-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

/** Render a single child block inside the subagent container. */
function renderChildBlock(
  block: ContentBlock,
  index: number,
  isStreaming: boolean,
  toolResultMap: Map<string, string>,
) {
  switch (block.type) {
    case 'text':
      return (
        <Streamdown
          key={index}
          className="chat-md text-xs px-1"
          plugins={streamdownPlugins}
          components={streamdownComponents}
          controls={streamdownControls}
          isAnimating={isStreaming}
        >
          {block.text}
        </Streamdown>
      )
    case 'tool_use':
      return (
        <ToolBlock
          key={index}
          toolName={block.toolName}
          input={block.input}
          status={block.status}
          elapsedSeconds={block.elapsedSeconds}
          result={toolResultMap.get(block.toolUseId)}
        />
      )
    case 'tool_result':
      if (toolResultMap.has(block.toolUseId)) return null
      if (!block.summary) return null
      return (
        <div key={index} className="my-0.5 overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {block.summary}
        </div>
      )
    default:
      return null
  }
}
