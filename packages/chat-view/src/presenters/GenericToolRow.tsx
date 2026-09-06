import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { AskUserQuestionResultPresenter } from './AskUserQuestionResult'
import { resolveArtifactLink } from './artifact-link'
import { getStallColor, type StallLevel } from './stall-color'
import { ToolIcon } from './ToolIcon'
import { ToolName } from './ToolRow'
import {
  formatReadMeta,
  getToolDisplay,
  getToolLabel,
  getToolVerb,
  parseMcpToolName,
  parseToolInput,
} from './tool-display'
import {
  computeLineDelta,
  computeStreamingEditDelta,
  extractToolError,
  unwrapMcpResultText,
} from './tool-block-utils'
import { isWorkflowSmokeCheck } from './workflow-utils'
import type { RemoteDiffTokens } from './remote-diff'
import type { QuestionPreviewFormat } from '@superone/shared/agent-types'

const DIFF_TOOLS = new Set(['Edit', 'Write', 'FileChange'])
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])
const RESULT_PREVIEW_LINES = 10
const SCROLLABLE_RESULT_MAX_H = 'max-h-60'

export interface FileChipPortProps {
  name: string
  title: string
  filePath: string
  className?: string
}

export interface FileDiffPresenterProps {
  toolName: 'Edit' | 'Write' | 'FileChange'
  params: Record<string, unknown>
  isStreaming: boolean
  useCanvasEdit: boolean
  /**
   * Diff precomputed by the desktop for surfaces that never receive the edited bodies.
   * The desktop itself leaves this undefined and renders from `params`.
   */
  toolDiff?: string
  toolDiffTokens?: RemoteDiffTokens
}

/**
 * Host-supplied pieces of the shared row. Everything here is either platform-bound
 * (opening a file, a syntax-highlighted diff, sanitized HTML) or optional chrome the
 * WebView deliberately renders plainer than the desktop does.
 */
export interface GenericToolRowPorts {
  cwd: string
  homedir: string
  streamingInputPreview?: Record<string, unknown>
  mcpIconSrc?: string
  stallLevel: StallLevel
  /**
   * Prefer the summary the sender computed over the one derived from the input.
   * A remote surface has no checkout, so `shortenPath` cannot shorten anything and the
   * derived summary would print an absolute path where the desktop prints a relative one —
   * but the desktop already sent the shortened string as `toolSummary`.
   */
  preferSentSummary?: boolean
  renderFileChip: (props: FileChipPortProps) => ReactNode
  renderFileDiff: (props: FileDiffPresenterProps) => ReactNode
  renderArtifactChip: (props: { url: string; label: string }) => ReactNode
  /** Line-delta counter; the desktop animates it, the phone prints it. */
  renderCount: (value: number) => ReactNode
  renderJson: (text: string) => ReactNode
  renderQuestionPreview: (props: { content: string; format: QuestionPreviewFormat }) => ReactNode
}

export interface GenericToolRowProps {
  toolName: string
  toolUseId?: string
  input: string
  toolSummary?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isError?: boolean
  /** Precomputed edit metadata — the only diff source a remote surface has. */
  toolDiff?: string
  toolDiffTokens?: RemoteDiffTokens
  toolLineDelta?: { added: number; removed: number }
  autoExpand?: boolean
  allowExpand: boolean
  defaultAutoExpand?: boolean
  autoExpandFileDiffs: boolean
  ports: GenericToolRowPorts
}

/** Full output in a fixed-height scroll area (no nested expand). */
function ScrollableToolResult({ text }: { text: string }) {
  return (
    <div
      className={cn(
        'overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap',
        SCROLLABLE_RESULT_MAX_H,
      )}
    >
      {text}
    </div>
  )
}

/** Truncated tool output with secondary expand for long results. */
function ToolResult({ text }: { text: string }) {
  const { t } = useTranslation()
  const lines = text.split('\n')
  const isLong = lines.length > RESULT_PREVIEW_LINES
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - RESULT_PREVIEW_LINES

  const visibleText = showAll || !isLong ? text : lines.slice(0, RESULT_PREVIEW_LINES).join('\n')

  return (
    <div>
      <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {visibleText}
      </div>
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? t('chat.toolBlock.collapse') : t('chat.toolBlock.moreLines', { count: hiddenCount })}
        </button>
      )}
    </div>
  )
}

/**
 * The tool row every surface falls back to once the specialized families have had their
 * turn: icon, name, summary, file chip, line delta, elapsed, and the expandable body.
 *
 * It reads only the block fields the phone already receives, so the WebView renders the
 * same row the desktop does — the differences live entirely in `ports`.
 */
export function GenericToolRowPresenter({
  toolName,
  input,
  toolSummary,
  status,
  elapsedSeconds,
  result,
  isError,
  toolDiff,
  toolDiffTokens,
  toolLineDelta,
  autoExpand,
  allowExpand,
  defaultAutoExpand,
  autoExpandFileDiffs,
  ports,
}: GenericToolRowProps) {
  const { t } = useTranslation()
  const shouldAutoExpandDiff = allowExpand && (autoExpand ?? defaultAutoExpand ?? autoExpandFileDiffs)
  const parsedParams = useMemo(() => parseToolInput(input, toolName), [input, toolName])
  const isStreaming = status === 'streaming'
  const params = isStreaming && ports.streamingInputPreview ? ports.streamingInputPreview : parsedParams
  const display = useMemo(() => getToolDisplay(toolName, params, ports.cwd, ports.homedir), [toolName, params, ports.cwd, ports.homedir])
  const mcpInfo = parseMcpToolName(toolName)
  const isMcp = mcpInfo !== null
  const fileToolPath = FILE_PATH_TOOLS.has(toolName) ? String(params.file_path ?? params.notebook_path ?? '') : ''
  const fileToolName = fileToolPath ? fileToolPath.split('/').pop() || '' : ''

  const isDenied = !!result && result.startsWith('[denied] ')
  const rawResult = isDenied ? result.slice('[denied] '.length) : result
  const cleanResult = useMemo(
    () => (isMcp && rawResult ? unwrapMcpResultText(rawResult) : rawResult),
    [isMcp, rawResult],
  )
  const artifactLink = useMemo(
    () => (toolName === 'Artifact' ? resolveArtifactLink(params, isDenied ? null : cleanResult) : null),
    [toolName, params, isDenied, cleanResult],
  )
  const deniedFeedback = isDenied && cleanResult !== 'User denied permission' ? cleanResult! : ''
  const feedbackRef = useRef<HTMLSpanElement>(null)
  const [feedbackIsBlock, setFeedbackIsBlock] = useState(false)

  useLayoutEffect(() => {
    if (!deniedFeedback) { setFeedbackIsBlock(false); return }
    const el = feedbackRef.current
    if (!el) return
    setFeedbackIsBlock(el.scrollWidth > el.clientWidth)
  }, [deniedFeedback])

  const lineDelta = useMemo(() => {
    if (isDenied || isError) return null
    if (isStreaming && toolName === 'Edit' && 'new_string' in params) {
      return computeStreamingEditDelta(String(params.old_string ?? ''), String(params.new_string ?? ''))
    }
    return computeLineDelta(toolName, params) ?? toolLineDelta ?? null
  }, [toolName, params, isDenied, isError, isStreaming, toolLineDelta])
  const hasStreamingDiffContent = DIFF_TOOLS.has(toolName) && isStreaming && (
    toolName === 'Edit'
      ? String(params.new_string ?? '').length > 0 || String(params.old_string ?? '').length > 0
      : toolName === 'Write'
        ? String(params.content ?? '').length > 0
        : String(params.diff ?? '').length > 0
  )
  const hasCompleteDiff = DIFF_TOOLS.has(toolName) && !isStreaming && !isDenied && !isError && (
    Boolean(toolDiff)
      || (toolName === 'FileChange'
        ? String(params.diff ?? '').length > 0
        : Object.keys(params).length > 0)
  )
  const hasDiff = hasCompleteDiff || hasStreamingDiffContent
  const [expanded, setExpanded] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (DIFF_TOOLS.has(toolName) && hasDiff && shouldAutoExpandDiff) {
      setExpanded(true)
      const grid = gridRef.current
      if (grid && !isStreaming) {
        grid.style.transition = 'none'
        requestAnimationFrame(() => { grid.style.transition = '' })
      }
    }
  }, [isStreaming, hasDiff, toolName, shouldAutoExpandDiff])

  useLayoutEffect(() => {
    if (isError) setExpanded(false)
  }, [isError])

  const isQuestionDismissed = toolName === 'AskUserQuestion' && !!result && (isDenied || result.includes('dismissed'))
  const hasResult = !!cleanResult && !isStreaming && !isDenied && toolName !== 'Read' && toolName !== 'Skill' && toolName !== 'AskUserQuestion'
  const hasQA = toolName === 'AskUserQuestion' && !!cleanResult && !isStreaming && !isQuestionDismissed
  const expandable = allowExpand && (hasDiff || hasResult || hasQA)

  // Prefer parsed input summary; fall back to ACP/main toolSummary (Grok title / raw_output).
  // Remote surfaces invert that — see `preferSentSummary`.
  const sentSummary = toolSummary?.trim() ?? ''
  const summary = (ports.preferSentSummary
    ? (sentSummary || display.summary)
    : (display.summary || sentSummary))
    || (!isMcp && display.icon === 'wrench' && input.length > 0
      ? (input.length > 80 ? input.slice(0, 80) + '…' : input)
      : '')

  // A titled publish would otherwise print its title twice — once as the
  // summary, once as the chip label. One identity per header.
  const headerSummary = artifactLink && summary === artifactLink.label ? '' : summary

  const displayName = mcpInfo
    ? <>{mcpInfo.serverName}<span className="text-muted-foreground"> · </span>{mcpInfo.mcpToolName.replace(/_/g, ' ')}</>
    : toolName === 'Workflow' && isWorkflowSmokeCheck(params)
      ? 'Smoke check'
      : getToolLabel(toolName)

  return (
    <div
      className={cn(
        'tool-node my-0.5 min-w-0 rounded transition-colors',
        isDenied ? 'denied bg-error/10' : isError ? 'errored bg-warning/10' : 'bg-muted/20',
        expandable && 'cursor-pointer',
        expandable && (isDenied ? 'hover:bg-error/20' : isError ? 'hover:bg-warning/20' : 'hover:bg-muted/40')
      )}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : isError ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : isMcp && ports.mcpIconSrc ? (
          <img src={ports.mcpIconSrc} alt={mcpInfo.serverName} className="size-3.5 shrink-0 rounded-sm object-cover" />
        ) : (
          <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <ToolName
          streaming={isStreaming}
          tone={isDenied && toolName !== 'AskUserQuestion' ? 'denied' : isError ? 'error' : 'default'}
        >
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName === 'AskUserQuestion' ? `Asked${display.summary ? ` ${display.summary}` : ''}` : displayName}
        </ToolName>
        {isQuestionDismissed ? (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground">{t('chat.toolBlock.dismissed')}</span>
        ) : isDenied ? (
          <>
            {fileToolName ? (
              ports.renderFileChip({ name: fileToolName, title: display.summary, filePath: fileToolPath })
            ) : summary ? (
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
            ) : null}
            <span className="shrink-0 rounded bg-error/20 px-1 py-px text-xs text-error">{t('chat.toolBlock.denied')}</span>
            {deniedFeedback && !feedbackIsBlock && (
              <span ref={feedbackRef} className="min-w-0 truncate text-error/70">{deniedFeedback}</span>
            )}
          </>
        ) : isError ? (
          <>
            {fileToolName ? (
              ports.renderFileChip({ name: fileToolName, title: display.summary, filePath: fileToolPath })
            ) : summary ? (
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
            ) : null}
            <span className="shrink-0 rounded bg-warning/20 px-1 py-px text-xs text-warning">{t('chat.toolBlock.error')}</span>
          </>
        ) : fileToolName ? (
          <>
            {ports.renderFileChip({ name: fileToolName, title: display.summary, filePath: fileToolPath })}
            {toolName === 'Read' && formatReadMeta(params) && (
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">{formatReadMeta(params)}</span>
            )}
          </>
        ) : headerSummary ? (
          <span className="min-w-0 truncate text-muted-foreground">{headerSummary}</span>
        ) : null}
        {!isDenied && !isError && artifactLink && ports.renderArtifactChip(artifactLink)}
        {lineDelta && (lineDelta.added > 0 || lineDelta.removed > 0) && (
          <span className="shrink-0 font-mono text-xs">
            {lineDelta.added > 0 && (
              <span className="inline-flex items-baseline text-success">
                +{ports.renderCount(lineDelta.added)}
              </span>
            )}
            {lineDelta.added > 0 && lineDelta.removed > 0 && <span className="text-muted-foreground/50"> </span>}
            {lineDelta.removed > 0 && (
              <span className="inline-flex items-baseline text-error">
                -{ports.renderCount(lineDelta.removed)}
              </span>
            )}
          </span>
        )}
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className={cn('ml-auto shrink-0 transition-colors duration-500', getStallColor(ports.stallLevel))}>{Math.round(elapsedSeconds)}s</span>
        )}
        {expandable && (
          <ChevronRight
            className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
          />
        )}
      </div>

      {deniedFeedback && feedbackIsBlock && (
        <div className="px-2 pb-1.5 text-xs text-error/70">{deniedFeedback}</div>
      )}

      {expandable && (
        <div
          ref={gridRef}
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-2 pb-1.5">
              {expanded && (
                <>
                  {DIFF_TOOLS.has(toolName) && ports.renderFileDiff({
                    toolName: toolName as FileDiffPresenterProps['toolName'],
                    params,
                    isStreaming,
                    useCanvasEdit: toolName === 'Edit'
                      && isStreaming
                      && (String(params.old_string ?? '') || String(params.new_string ?? '')) !== '',
                    toolDiff,
                    toolDiffTokens,
                  })}
                  {isError && cleanResult && (
                    <div className="text-xs text-warning/90">{extractToolError(cleanResult)}</div>
                  )}
                  {hasResult && !isError && (!hasDiff || toolName === 'FileChange') && (
                    <div onClick={(e) => e.stopPropagation()}>
                      {isMcp ? (
                        ports.renderJson(cleanResult!)
                      ) : toolName === 'LS' || toolName === 'ToolSearch' || toolName === 'SearchTools' ? (
                        <ScrollableToolResult text={cleanResult!} />
                      ) : (
                        <ToolResult text={cleanResult!} />
                      )}
                    </div>
                  )}
                  {hasQA && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <AskUserQuestionResultPresenter
                        text={cleanResult!}
                        params={params}
                        renderPreview={ports.renderQuestionPreview}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
