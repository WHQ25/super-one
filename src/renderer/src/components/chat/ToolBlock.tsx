import { useState, useEffect, useMemo } from 'react'
import { Loader2, ChevronRight, PenLine, Check, X, Ban } from 'lucide-react'
import { diffLines } from 'diff'
import { cn } from '@/lib/utils'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { ToolIcon } from './ToolIcon'
import { HighlightedCodeBlock } from './CodeBlock'
import { getToolDisplay, parseToolInput, parseMcpToolName } from './tool-display'
import { codePlugin } from './chat-shared'

/** Dev-only: comma-separated tool names to show raw debug UI. e.g. RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

interface ToolBlockProps {
  toolName: string
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'FileChange'])

function splitContentLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

function countContentLines(text: string): number {
  return splitContentLines(text).length
}

function countUnifiedDiffDelta(diff: string): { added: number; removed: number } | null {
  if (!diff) return null
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  let inHunk = false
  let added = 0
  let removed = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }

  return added > 0 || removed > 0 ? { added, removed } : null
}

function countPrefixedDiffDelta(diff: string): { added: number; removed: number } | null {
  if (!diff) return null
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return added > 0 || removed > 0 ? { added, removed } : null
}

/** Compute line-level additions/removals for diff-capable tools. */
function computeLineDelta(toolName: string, params: Record<string, unknown>): { added: number; removed: number } | null {
  if (toolName === 'Write') {
    const content = String(params.content ?? '')
    if (!content) return null
    const added = countContentLines(content)
    return { added, removed: 0 }
  }
  if (toolName === 'Edit') {
    const oldStr = String(params.old_string ?? '')
    const newStr = String(params.new_string ?? '')
    if (!oldStr && !newStr) return null
    const changes = diffLines(oldStr, newStr)
    let added = 0, removed = 0
    for (const c of changes) {
      const count = c.value.replace(/\n$/, '').split('\n').length
      if (c.added) added += count
      else if (c.removed) removed += count
    }
    return { added, removed }
  }
  if (toolName === 'FileChange') {
    const kind = String(params.kind ?? '')
    const diff = String(params.diff ?? '')
    if (!diff) return null
    if (kind === 'add') return { added: countContentLines(diff), removed: 0 }
    if (kind === 'delete') return { added: 0, removed: countContentLines(diff) }
    return countUnifiedDiffDelta(diff) ?? countPrefixedDiffDelta(diff)
  }
  return null
}

/** Try to format a string as prettified JSON. Returns null if not valid JSON. */
function tryPrettifyJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify(parsed, null, 2)
    }
  } catch { /* not JSON */ }
  return null
}

export function ToolBlock({ toolName, input, status, elapsedSeconds, result }: ToolBlockProps) {
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const params = useMemo(() => parseToolInput(input), [input])
  const display = useMemo(() => getToolDisplay(toolName, params, cwd, homedir), [toolName, params, cwd, homedir])
  const mcpInfo = parseMcpToolName(toolName)
  const isMcp = mcpInfo !== null
  const mcpMeta = useSettingsStore((s) => s.mcpMeta)
  const mcpLibrary = useSettingsStore((s) => s.mcpLibrary)
  const mcpIconSrc = isMcp
    ? (mcpMeta[mcpInfo.serverName]?.icons?.[0]?.src
      ?? mcpLibrary.find((e) => e.name === mcpInfo.serverName)?.icons?.[0]?.src)
    : undefined
  const isStreaming = status === 'streaming'

  // Debug mode (dev only): highest priority — show raw input/output for matching tools
  // Set RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate to enable
  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => toolName.toLowerCase().includes(n))
  if (isDebug) {
    return <DebugToolBlock toolName={toolName} input={input} result={result} status={status} elapsedSeconds={elapsedSeconds} />
  }

  // Hide TodoWrite from chat — handled by TodoPopup
  if (toolName === 'TodoWrite') return null

  // Plan mode tools — compact inline indicator
  if (toolName === 'EnterPlanMode') {
    return (
      <div className="my-0.5 flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 text-xs">
        <PenLine className="size-3 shrink-0 text-blue-400" />
        <span className="font-medium text-blue-400">Entered plan mode</span>
      </div>
    )
  }
  if (toolName === 'ExitPlanMode') {
    return <ExitPlanModeBlock />
  }

  const isDenied = !!result && result.startsWith('[denied] ')
  const cleanResult = isDenied ? result.slice('[denied] '.length) : result

  const lineDelta = useMemo(() => (!isStreaming && !isDenied) ? computeLineDelta(toolName, params) : null, [toolName, params, isStreaming, isDenied])
  const hasDiff = DIFF_TOOLS.has(toolName) && !isStreaming && !isDenied && (
    toolName === 'FileChange'
      ? String(params.diff ?? '').length > 0
      : Object.keys(params).length > 0
  )
  const hasResult = !!cleanResult && !isStreaming && !isDenied && toolName !== 'Read' && toolName !== 'Skill' && toolName !== 'AskUserQuestion'
  const hasQA = toolName === 'AskUserQuestion' && !!cleanResult && !isStreaming
  const expandable = hasDiff || hasResult || hasQA
  const [expanded, setExpanded] = useState(false)

  // For unknown tools, show truncated raw input as fallback
  const summary = display.summary || (!isMcp && display.icon === 'wrench' && input.length > 0
    ? (input.length > 80 ? input.slice(0, 80) + '\u2026' : input)
    : '')

  const displayName = mcpInfo
    ? <>{mcpInfo.serverName}<span className="text-muted-foreground"> · </span>{mcpInfo.mcpToolName}</>
    : toolName

  return (
    <div
      className={cn(
        'tool-node my-0.5 rounded transition-colors',
        isDenied ? 'bg-red-500/10' : 'bg-muted/50',
        expandable && 'cursor-pointer hover:bg-muted/70'
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-red-400" />
        ) : isMcp && mcpIconSrc ? (
          <img src={mcpIconSrc} alt={mcpInfo.serverName} className="size-3.5 shrink-0 rounded-sm object-cover" />
        ) : (
          <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('font-medium', isDenied ? 'text-red-400' : 'text-foreground')}>{displayName}</span>
        {isStreaming && <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />}
        {isDenied ? (
          <>
            {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
            <span className="rounded bg-red-500/20 px-1 py-px text-[10px] text-red-400">Denied</span>
            {cleanResult !== 'User denied permission' && (
              <span className="shrink-0 text-red-400/70">{cleanResult}</span>
            )}
          </>
        ) : summary ? (
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        ) : null}
        {lineDelta && (
          <span className="shrink-0 font-mono text-[11px]">
            {lineDelta.added > 0 && <span className="text-green-400">+{lineDelta.added}</span>}
            {lineDelta.added > 0 && lineDelta.removed > 0 && <span className="text-muted-foreground/50"> </span>}
            {lineDelta.removed > 0 && <span className="text-red-400">-{lineDelta.removed}</span>}
          </span>
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
              {toolName === 'FileChange' && <FileChangeDiff params={params} />}
              {hasResult && (!hasDiff || toolName === 'FileChange') && (
                <div>
                  {toolName === 'Bash' && <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Output</div>}
                  {isMcp ? <PrettyJSONCodeBlock text={cleanResult!} /> : <ToolResult text={cleanResult!} />}
                </div>
              )}
              {hasQA && <QAResult text={cleanResult!} />}
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

/** Prettified JSON code block with syntax highlighting and truncation. */
function PrettyJSONCodeBlock({ text }: { text: string }) {
  const jsonResult = useMemo(() => tryPrettifyJson(text), [text])
  const prettified = jsonResult ?? text
  const language = jsonResult ? 'json' : 'text'
  const lines = prettified.split('\n')
  const previewLines = 20
  const isLong = lines.length > previewLines
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - previewLines
  const visibleText = showAll || !isLong ? prettified : lines.slice(0, previewLines).join('\n')

  return (
    <div className="-mx-2">
      <HighlightedCodeBlock code={visibleText} language={language} codePlugin={codePlugin} />
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 ml-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
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

/** Infer language from file extension for syntax highlighting. */
function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    html: 'html', css: 'css', scss: 'scss', md: 'markdown',
    sh: 'bash', bash: 'bash', sql: 'sql', swift: 'swift',
    kt: 'kotlin', c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php',
  }
  return map[ext] ?? 'text'
}

interface HLToken { content: string; style?: React.CSSProperties }

/** Highlight code with codePlugin and return token arrays per line. */
function useHighlightedTokens(code: string, language: string): HLToken[][] | null {
  const [tokens, setTokens] = useState<HLToken[][] | null>(null)

  useEffect(() => {
    if (!code) { setTokens(null); return }
    const lang = codePlugin.supportsLanguage(language as never) ? language : 'md'
    const themes = codePlugin.getThemes()
    const extract = (res: { tokens: Array<Array<{ content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }>> }): HLToken[][] =>
      res.tokens.map((line) => line.map((t) => {
        const s: React.CSSProperties = { ...(t.htmlStyle ?? {}) }
        if (t.color) s.color = t.color
        if (t.bgColor) s.backgroundColor = t.bgColor
        return { content: t.content, style: Object.keys(s).length ? s : undefined }
      }))
    const result = codePlugin.highlight(
      { code, language: lang as never, themes },
      (res) => setTokens(extract(res)),
    )
    if (result) setTokens(extract(result))
  }, [code, language])

  return tokens
}

/** A single rendered line in the diff view. */
interface DiffLine {
  kind: 'added' | 'removed' | 'unchanged'
  lineNum: number
  text: string
  sourceIdx: number
}

/** Build unified diff lines with actual file line numbers. */
function buildDiffLines(oldStr: string, newStr: string, startLine: number): DiffLine[] {
  const changes = diffLines(oldStr, newStr)
  const result: DiffLine[] = []
  let oldLine = startLine
  let newLine = startLine
  let oldIdx = 0
  let newIdx = 0

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    if (change.removed) {
      for (const text of lines) {
        result.push({ kind: 'removed', lineNum: oldLine++, text, sourceIdx: oldIdx++ })
      }
    } else if (change.added) {
      for (const text of lines) {
        result.push({ kind: 'added', lineNum: newLine++, text, sourceIdx: newIdx++ })
      }
    } else {
      for (const text of lines) {
        result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
        oldLine++; newLine++; oldIdx++; newIdx++
      }
    }
  }
  return result
}

function buildUnifiedFileChangeDiffLines(unifiedDiff: string): DiffLine[] {
  const rows = splitContentLines(unifiedDiff)
  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0
  let inHunk = false

  for (const row of rows) {
    if (row.startsWith('@@')) {
      const match = row.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      inHunk = true
      continue
    }

    if (!inHunk || row.startsWith('\\')) continue

    if (row.startsWith('+')) {
      result.push({ kind: 'added', lineNum: newLine++, text: row.slice(1), sourceIdx: newIdx++ })
      continue
    }
    if (row.startsWith('-')) {
      result.push({ kind: 'removed', lineNum: oldLine++, text: row.slice(1), sourceIdx: oldIdx++ })
      continue
    }

    const text = row.startsWith(' ') ? row.slice(1) : row
    result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
    oldLine++
    newLine++
    oldIdx++
    newIdx++
  }

  return result
}

function buildFileChangeDiffLines(kind: string, diffText: string): DiffLine[] {
  const rows = splitContentLines(diffText)
  if (rows.length === 0) return []

  if (kind === 'add') {
    return rows.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }
  if (kind === 'delete') {
    return rows.map((text, i) => ({ kind: 'removed' as const, lineNum: i + 1, text, sourceIdx: i }))
  }

  const unified = buildUnifiedFileChangeDiffLines(diffText)
  if (unified.length > 0) return unified

  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0

  for (const row of rows) {
    if (row.startsWith('+') && !row.startsWith('+++')) {
      result.push({ kind: 'added', lineNum: newLine++, text: row.slice(1), sourceIdx: newIdx++ })
      continue
    }
    if (row.startsWith('-') && !row.startsWith('---')) {
      result.push({ kind: 'removed', lineNum: oldLine++, text: row.slice(1), sourceIdx: oldIdx++ })
      continue
    }
    const text = row.startsWith(' ') ? row.slice(1) : row
    result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
    oldLine++
    newLine++
    oldIdx++
    newIdx++
  }

  return result
}

function buildDiffSourceText(lines: DiffLine[]): { oldText: string; newText: string } {
  const oldParts: string[] = []
  const newParts: string[] = []

  for (const line of lines) {
    if (line.kind !== 'added') oldParts.push(line.text)
    if (line.kind !== 'removed') newParts.push(line.text)
  }

  return {
    oldText: oldParts.join('\n'),
    newText: newParts.join('\n'),
  }
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

/** Render a list of DiffLine entries with optional syntax highlighting. */
function DiffView({ lines, oldTokens, newTokens }: {
  lines: DiffLine[]
  oldTokens?: HLToken[][] | null
  newTokens?: HLToken[][] | null
}) {
  const maxLine = lines.reduce((m, l) => Math.max(m, l.lineNum), 0)
  const gw = gutterWidth(maxLine)

  return (
    <div className="max-h-[300px] overflow-auto rounded bg-background/70 p-2 text-[11px] font-mono leading-relaxed text-foreground">
      {lines.map((line, i) => {
        const s = LINE_STYLE[line.kind]
        const tokens = line.kind === 'removed'
          ? oldTokens?.[line.sourceIdx]
          : (newTokens ?? oldTokens)?.[line.sourceIdx]
        return (
          <div key={i} className={cn('whitespace-pre', s.bg)}>
            <span className="inline-block select-none text-right text-muted-foreground/50 mr-1" style={{ width: `${gw}ch` }}>
              {line.lineNum}
            </span>
            <span className={cn('inline-block w-[1ch] select-none text-center mr-1', s.markerColor)}>{s.marker}</span>
            {tokens
              ? tokens.map((t, j) => (
                  <span key={j} style={t.style}>{t.content}</span>
                ))
              : (line.text || ' ')}
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
  const activeProject = useChatStore((s) => s.activeProject)
  const [startLine, setStartLine] = useState(1)
  const language = inferLanguage(filePath)
  const oldTokens = useHighlightedTokens(oldStr, language)
  const newTokens = useHighlightedTokens(newStr, language)

  useEffect(() => {
    if (!filePath || !activeProject) return
    let cancelled = false
    const tryFind = async (): Promise<void> => {
      // Try new_string first (file already edited)
      if (newStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, newStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
      // Fallback to old_string (edit pending or denied)
      if (oldStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, oldStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
    }
    tryFind()
    return () => { cancelled = true }
  }, [filePath, oldStr, newStr, activeProject])

  const lines = useMemo(
    () => buildDiffLines(oldStr, newStr, startLine),
    [oldStr, newStr, startLine],
  )

  if (!oldStr && !newStr) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} />
}

/** Content preview for Write tool (all lines are additions). */
function WriteDiff({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const tokens = useHighlightedTokens(content, language)

  const lines = useMemo<DiffLine[]>(() => {
    if (!content) return []
    return content.split('\n').map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }, [content])

  if (lines.length === 0) return null
  return <DiffView lines={lines} newTokens={tokens} />
}

function FileChangeDiff({ params }: { params: Record<string, unknown> }) {
  const diff = String(params.diff ?? '')
  const kind = String(params.kind ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildFileChangeDiffLines(kind, diff), [kind, diff])
  const { oldText, newText } = useMemo(() => buildDiffSourceText(lines), [lines])
  const oldTokens = useHighlightedTokens(oldText, language)
  const newTokens = useHighlightedTokens(newText, language)

  if (!diff || lines.length === 0) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} />
}

/** ExitPlanMode: shows pending / approved / rejected state. */
function ExitPlanModeBlock() {
  const outcome = useActiveSession((s) => s.planApprovalOutcome)

  if (!outcome) {
    // Pending — plan is being reviewed
    return (
      <div className="my-0.5 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs">
        <PenLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Review Plan</span>
      </div>
    )
  }

  if (outcome.approved) {
    return (
      <div className="my-0.5 flex items-center gap-1.5 rounded bg-green-500/10 px-2 py-1.5 text-xs">
        <PenLine className="size-3 shrink-0 text-green-400" />
        <span className="font-medium text-green-400">Plan Approved</span>
        <Check className="ml-auto size-3 shrink-0 text-green-400" />
      </div>
    )
  }

  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-1.5 text-xs">
      <PenLine className="size-3 shrink-0 text-red-400" />
      <span className="font-medium text-red-400">Plan Rejected</span>
      {outcome.feedback && (
        <span className="min-w-0 truncate text-red-400/70">{outcome.feedback}</span>
      )}
      <X className="ml-auto size-3 shrink-0 text-red-400" />
    </div>
  )
}

/** Debug view showing raw input and output for a tool call. */
function DebugToolBlock({
  toolName,
  input,
  result,
  status,
  elapsedSeconds,
}: {
  toolName: string
  input: string
  result?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
}) {
  const isStreaming = status === 'streaming'
  const prettyInput = tryPrettifyJson(input) ?? input

  return (
    <div className="my-0.5 rounded border border-amber-500/30 bg-muted/50">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        {isStreaming ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />
        ) : (
          <span className="size-3 shrink-0 text-center text-amber-400">&#9881;</span>
        )}
        <span className="font-medium text-amber-400">{toolName}</span>
        <span className="rounded bg-amber-500/20 px-1 py-px text-[10px] text-amber-400">debug</span>
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
        )}
      </div>
      <div className="px-2 pb-1.5 space-y-1.5">
        <div>
          <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Input</div>
          <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
            {prettyInput || <span className="text-muted-foreground italic">empty</span>}
          </div>
        </div>
        {result && !isStreaming && (
          <div>
            <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Output</div>
            <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
