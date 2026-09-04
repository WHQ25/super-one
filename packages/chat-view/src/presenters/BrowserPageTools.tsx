import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { humanizePageToolName } from '@superone/shared/page-tool-name'
import { cn } from '@superone/ui/lib/utils'
import { ToolName, ToolRow, ToolSummary, type ToolRowTone } from './ToolRow'
import {
  originHost,
  pageToolInputSummary,
  parsePageToolCall,
  parsePageToolOutcome,
  parsePageToolsList,
} from './page-tools-display'

export interface BrowserPageToolsBlockPresenterProps {
  params: Record<string, unknown>
  result?: string
  toolSummary?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  elapsedClassName?: string
  allowExpand?: boolean
  renderPageIcon?: (identity: { origin?: string; tabId?: string }) => ReactNode
  renderJson?: (text: string) => ReactNode
}

function defaultPageIcon() {
  return <Globe className="size-3 shrink-0 text-muted-foreground" />
}

function defaultJson(text: string) {
  let display = text
  try { display = JSON.stringify(JSON.parse(text), null, 2) } catch { /* preserve text */ }
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-foreground/85">{display}</pre>
}

function pageIcon(
  renderPageIcon: BrowserPageToolsBlockPresenterProps['renderPageIcon'],
  origin: string | undefined,
  params: Record<string, unknown>,
) {
  const tabId = typeof params.tab === 'string' ? params.tab : undefined
  return renderPageIcon?.({ origin, tabId }) ?? defaultPageIcon()
}

function elapsed(seconds: number | undefined, className?: string) {
  if (seconds == null || seconds < 1) return null
  return (
    <span className={cn('ml-auto shrink-0 transition-colors duration-500', className ?? 'text-muted-foreground')}>
      {Math.round(seconds)}s
    </span>
  )
}

function toneOf(isDenied: boolean, isError: boolean): ToolRowTone {
  return isDenied ? 'denied' : isError ? 'error' : 'default'
}

function useClamped(text: string | undefined): [React.RefObject<HTMLParagraphElement | null>, boolean] {
  const ref = useRef<HTMLParagraphElement>(null)
  const [clamped, setClamped] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !text || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setClamped(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  return [ref, clamped]
}

function PageToolItem({ name, description }: { name: string; description?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [ref, clamped] = useClamped(description)
  const toggle = useCallback(() => setExpanded((value) => !value), [])
  const canToggle = clamped || expanded
  return (
    <li className="min-w-0">
      <div className="truncate font-medium text-foreground" title={name}>{humanizePageToolName(name)}</div>
      {description ? (
        <p
          ref={ref}
          onClick={canToggle ? toggle : undefined}
          className={cn(
            'mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug text-muted-foreground',
            !expanded && 'line-clamp-2',
            canToggle && 'cursor-pointer hover:text-foreground/80',
          )}
        >
          {description}
        </p>
      ) : null}
    </li>
  )
}

export function BrowserPageToolsListBlockPresenter({
  params,
  result,
  toolSummary,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  elapsedClassName,
  allowExpand = true,
  renderPageIcon,
}: BrowserPageToolsBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parsePageToolsList(result), [result])
  const outcome = useMemo(
    () => parsePageToolOutcome(result, { isError, isDenied }),
    [result, isError, isDenied],
  )
  const denied = outcome.status === 'denied'
  const errored = outcome.status === 'error'
  const tone = toneOf(denied, errored)
  const tools = denied || errored ? [] : info?.tools ?? []
  const count = info?.count ?? 0
  const label = isStreaming
    ? `${t('chat.toolBlock.browser.listingPageTools')}…`
    : denied || errored
      ? t('chat.toolBlock.browser.toolsList')
      : count > 0
        ? t('chat.toolBlock.browser.pageToolsListed', { count })
        : t('chat.toolBlock.browser.pageToolsEmpty')
  const summary = denied || errored
    ? outcome.message
    : originHost(info?.origin) || (count === 0 ? info?.hint ?? toolSummary ?? '' : '')

  return (
    <ToolRow
      icon={pageIcon(renderPageIcon, outcome.origin ?? info?.origin, params)}
      iconIsIdentity
      tone={tone}
      expandable={allowExpand && !isStreaming && tools.length > 0}
      details={tools.length > 0 ? (
        <ul className="space-y-2">
          {tools.map((tool) => <PageToolItem key={tool.name} {...tool} />)}
        </ul>
      ) : null}
      trailing={isStreaming ? elapsed(elapsedSeconds, elapsedClassName) : null}
    >
      <ToolName streaming={isStreaming && !denied} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}

export function BrowserPageToolCallBlockPresenter({
  params,
  result,
  toolSummary,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  elapsedClassName,
  allowExpand = true,
  renderPageIcon,
  renderJson = defaultJson,
}: BrowserPageToolsBlockPresenterProps) {
  const { t } = useTranslation()
  const outcome = useMemo(
    () => parsePageToolOutcome(result, { isError, isDenied }),
    [result, isError, isDenied],
  )
  const call = useMemo(() => parsePageToolCall(result), [result])
  const denied = outcome.status === 'denied'
  const errored = outcome.status === 'error'
  const tone = toneOf(denied, errored)
  const rawToolName = typeof params.name === 'string' ? params.name.trim() : ''
  const toolName = rawToolName ? humanizePageToolName(rawToolName) : t('chat.toolBlock.browser.toolsCall')
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = pageToolInputSummary(params.input)
  const failure = errored ? outcome.message : ''
  const summary = denied
    ? outcome.message || description || inputSummary || toolSummary
    : description || inputSummary || toolSummary || failure
  const output = denied || errored ? '' : call.output.trim()
  const argsJson = useMemo(() => {
    const input = params.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
    return Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : ''
  }, [params.input])
  const failureBody = failure && failure !== summary ? failure : ''
  const hasBody = !!failureBody || !!output

  return (
    <ToolRow
      icon={pageIcon(renderPageIcon, outcome.origin ?? call.origin, params)}
      iconIsIdentity
      tone={tone}
      expandable={allowExpand && !isStreaming && hasBody}
      details={hasBody ? (
        <div className="space-y-2">
          {failureBody ? <div className="whitespace-pre-wrap break-words text-xs text-warning/90">{failureBody}</div> : null}
          {argsJson ? (
            <div>
              <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {t('chat.toolBlock.browser.pageToolArguments')}
              </div>
              {renderJson(argsJson)}
            </div>
          ) : null}
          {output ? (
            <div>
              {argsJson ? (
                <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t('chat.toolBlock.browser.result')}
                </div>
              ) : null}
              {renderJson(output)}
            </div>
          ) : null}
        </div>
      ) : null}
      detailsClassName="px-2 pb-1.5 text-xs"
      trailing={isStreaming ? elapsed(elapsedSeconds, elapsedClassName) : null}
    >
      <ToolName streaming={isStreaming && !denied} tone={tone}>
        <span title={rawToolName || undefined}>{isStreaming ? `${toolName}…` : toolName}</span>
      </ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}
