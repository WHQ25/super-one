import { useState, useEffect, useMemo } from 'react'
import { Loader2, ChevronRight } from 'lucide-react'
import { diffLines } from 'diff'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay, parseToolInput } from './tool-display'

interface ToolBlockProps {
  toolName: string
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
}

const DIFF_TOOLS = new Set(['Edit', 'Write'])

export function ToolBlock({ toolName, input, status, elapsedSeconds, result }: ToolBlockProps) {
  const cwd = useChatStore((s) => s.cwd)
  const homedir = useChatStore((s) => s.homedir)
  const params = parseToolInput(input)
  const display = getToolDisplay(toolName, params, cwd, homedir)
  const isStreaming = status === 'streaming'
  const hasDiff = DIFF_TOOLS.has(toolName) && !isStreaming && Object.keys(params).length > 0
  const hasResult = !!result && !isStreaming && toolName !== 'Read' && toolName !== 'Skill' && toolName !== 'AskUserQuestion'
  const hasQA = toolName === 'AskUserQuestion' && !!result && !isStreaming
  const expandable = hasDiff || hasResult || hasQA
  const [expanded, setExpanded] = useState(false)

  // For unknown tools, show truncated raw input as fallback
  const summary = display.summary || (display.icon === 'wrench' && input.length > 0
    ? (input.length > 80 ? input.slice(0, 80) + '\u2026' : input)
    : '')

  return (
    <div
      className={cn(
        'my-1 rounded bg-muted/50 transition-colors',
        expandable && 'cursor-pointer hover:bg-muted/70'
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {isStreaming ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />
        ) : (
          <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-foreground">{toolName}</span>
        {summary && (
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        )}
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
        )}
        {expandable && (
          <ChevronRight
            className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
          />
        )}
      </div>

      {expandable && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-2 pb-1.5">
              {toolName === 'Bash' && summary && (
                <div className="mb-1">
                  <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Command</div>
                  <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap">
                    {summary}
                  </div>
                </div>
              )}
              {toolName === 'Edit' && <EditDiff params={params} />}
              {toolName === 'Write' && <WriteDiff params={params} />}
              {hasResult && !hasDiff && (
                <div>
                  {toolName === 'Bash' && <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Output</div>}
                  <ToolResult text={result!} />
                </div>
              )}
              {hasQA && <QAResult text={result!} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const RESULT_PREVIEW_LINES = 10

/** Truncated tool output with secondary expand for long results. */
function ToolResult({ text }: { text: string }) {
  const lines = text.split('\n')
  const isLong = lines.length > RESULT_PREVIEW_LINES
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - RESULT_PREVIEW_LINES

  const visibleText = showAll || !isLong ? text : lines.slice(0, RESULT_PREVIEW_LINES).join('\n')

  return (
    <div>
      <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {visibleText}
      </div>
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? 'Collapse' : `${hiddenCount} more line${hiddenCount > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

/** Parse AskUserQuestion result text into question→answer pairs. */
function parseQAPairs(text: string): Array<{ question: string; answer: string }> {
  // Format: "question"="answer", "question"="answer"
  const pairs: Array<{ question: string; answer: string }> = []
  const regex = /"([^"]+)"="([^"]*)"/g
  let match
  while ((match = regex.exec(text)) !== null) {
    pairs.push({ question: match[1], answer: match[2] })
  }
  return pairs
}

/** Render AskUserQuestion result as Q&A pairs. */
function QAResult({ text }: { text: string }) {
  const pairs = parseQAPairs(text)
  if (pairs.length === 0) return null

  return (
    <div className="space-y-1">
      {pairs.map((pair, i) => (
        <div key={i} className="rounded bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed">
          <div className="text-muted-foreground">{pair.question}</div>
          <div className="text-green-400">{pair.answer}</div>
        </div>
      ))}
    </div>
  )
}

/** A single rendered line in the diff view. */
interface DiffLine {
  kind: 'added' | 'removed' | 'unchanged'
  lineNum: number
  text: string
}

/** Build unified diff lines with actual file line numbers. */
function buildDiffLines(oldStr: string, newStr: string, startLine: number): DiffLine[] {
  const changes = diffLines(oldStr, newStr)
  const result: DiffLine[] = []
  let oldLine = startLine
  let newLine = startLine

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    if (change.removed) {
      for (const text of lines) {
        result.push({ kind: 'removed', lineNum: oldLine++, text })
      }
    } else if (change.added) {
      for (const text of lines) {
        result.push({ kind: 'added', lineNum: newLine++, text })
      }
    } else {
      for (const text of lines) {
        result.push({ kind: 'unchanged', lineNum: newLine, text })
        oldLine++
        newLine++
      }
    }
  }
  return result
}

/** Line number gutter width based on max line number. */
function gutterWidth(maxLine: number): number {
  return Math.max(2, String(maxLine).length)
}

const LINE_STYLE: Record<DiffLine['kind'], { bg: string; marker: string; markerColor: string }> = {
  removed: { bg: 'bg-red-500/15', marker: '-', markerColor: 'text-red-400/60' },
  added: { bg: 'bg-green-500/15', marker: '+', markerColor: 'text-green-400/60' },
  unchanged: { bg: '', marker: ' ', markerColor: 'text-transparent' },
}

/** Render a list of DiffLine entries. */
function DiffView({ lines }: { lines: DiffLine[] }) {
  const maxLine = lines.reduce((m, l) => Math.max(m, l.lineNum), 0)
  const gw = gutterWidth(maxLine)

  return (
    <div className="overflow-x-auto rounded bg-background/70 p-2 text-[11px] font-mono leading-relaxed text-foreground">
      {lines.map((line, i) => {
        const s = LINE_STYLE[line.kind]
        return (
          <div key={i} className={s.bg}>
            <span className="select-none text-muted-foreground/50 mr-2">
              {String(line.lineNum).padStart(gw)}
            </span>
            <span className={cn('select-none mr-1', s.markerColor)}>{s.marker}</span>
            {line.text || ' '}
          </div>
        )
      })}
    </div>
  )
}

/** Unified diff for Edit tool with actual file line numbers. */
function EditDiff({ params }: { params: Record<string, unknown> }) {
  const oldStr = String(params.old_string ?? '')
  const newStr = String(params.new_string ?? '')
  const filePath = String(params.file_path ?? '')
  const [startLine, setStartLine] = useState(1)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    const tryFind = async (): Promise<void> => {
      // Try new_string first (file already edited)
      if (newStr) {
        const line = await window.agent.findLineNumber(filePath, newStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
      // Fallback to old_string (edit pending or denied)
      if (oldStr) {
        const line = await window.agent.findLineNumber(filePath, oldStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
    }
    tryFind()
    return () => { cancelled = true }
  }, [filePath, oldStr, newStr])

  const lines = useMemo(
    () => buildDiffLines(oldStr, newStr, startLine),
    [oldStr, newStr, startLine],
  )

  if (!oldStr && !newStr) return null
  return <DiffView lines={lines} />
}

/** Content preview for Write tool (all lines are additions, starting at line 1). */
function WriteDiff({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  if (!content) return null

  const allLines = content.split('\n')
  const MAX_LINES = 20
  const truncated = allLines.length > MAX_LINES
  const gw = gutterWidth(truncated ? allLines.length : MAX_LINES)

  const visibleLines: DiffLine[] = allLines
    .slice(0, MAX_LINES)
    .map((text, i) => ({ kind: 'added', lineNum: i + 1, text }))

  return (
    <div>
      <DiffView lines={visibleLines} />
      {truncated && (
        <div className="mt-0.5 px-2 text-[11px] text-muted-foreground">
          ... {allLines.length - MAX_LINES} more lines
        </div>
      )}
    </div>
  )
}
