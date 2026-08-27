import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { humanizePageToolName } from '@superone/shared/page-tool-name'
import { BrowserFavicon } from '@/components/browser/BrowserFavicon'
import { useBrowserStore } from '@/stores/browser'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { ToolIcon } from './ToolIcon'
import { ToolName, ToolRow, ToolSummary, type ToolRowTone } from './tool-row'
import { PrettyJSONCodeBlock, SectionLabel, ToolErrorText } from './tool-result-views'
import {
  originHost,
  pageToolInputSummary,
  parsePageToolCall,
  parsePageToolOutcome,
  parsePageToolsList,
} from './page-tools-display'

export interface BrowserPageToolsBlockProps {
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel: StallLevel
  allowExpand?: boolean
}

/**
 * WebMCP page tools carry the page's own identity, so they get the page favicon instead of the
 * generic globe — the same "this belongs to that app" grammar mini-app tools use. The favicon
 * comes from the origin-keyed main-process cache (see BrowserFavicon), which is already warm
 * because the page was loaded in a browser view.
 */
function PageIcon({ origin, tabUrl }: { origin?: string; tabUrl?: string }) {
  return (
    <BrowserFavicon
      url={origin || tabUrl || null}
      className="size-3.5 shrink-0"
      fallback={<ToolIcon icon="globe" className="size-3 shrink-0 text-muted-foreground" />}
    />
  )
}

/** Only an explicit `tab` argument identifies the page before the result lands. */
function useTabUrl(params: Record<string, unknown>): string | undefined {
  const tabId = typeof params.tab === 'string' ? params.tab : undefined
  return useBrowserStore((s) => (tabId ? s.tabs[tabId]?.url : undefined)) || undefined
}

function Elapsed({ elapsedSeconds, stallLevel }: { elapsedSeconds?: number; stallLevel: StallLevel }) {
  if (elapsedSeconds == null || elapsedSeconds < 1) return null
  return (
    <span className={cn('ml-auto shrink-0 transition-colors duration-500', getStallColor(stallLevel))}>
      {Math.round(elapsedSeconds)}s
    </span>
  )
}

function toneOf(isDenied: boolean, isError: boolean): ToolRowTone {
  return isDenied ? 'denied' : isError ? 'error' : 'default'
}

/** A description is only worth a click when it actually overflows its two-line clamp. */
function useClamped(text: string | undefined): [React.RefObject<HTMLParagraphElement | null>, boolean] {
  const ref = useRef<HTMLParagraphElement>(null)
  const [clamped, setClamped] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !text) return
    const measure = (): void => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])
  return [ref, clamped]
}

function PageToolItem({ name, description }: { name: string; description?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [ref, clamped] = useClamped(description)
  const toggle = useCallback(() => setExpanded((e) => !e), [])
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

export function BrowserPageToolsListBlock({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  stallLevel,
  allowExpand = true,
}: BrowserPageToolsBlockProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parsePageToolsList(result), [result])
  const outcome = useMemo(() => parsePageToolOutcome(result, { isError, isDenied }), [result, isError, isDenied])
  const tabUrl = useTabUrl(params)

  const denied = outcome.status === 'denied'
  const errored = outcome.status === 'error'
  const tone = toneOf(denied, errored)
  // A failed list has no catalog to show, so `info` is null — reading the count off it would
  // print "No Page Tools" and make a refusal look like a page that publishes nothing.
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
    : originHost(info?.origin) || (count === 0 ? info?.hint ?? '' : '')

  return (
    <ToolRow
      icon={<PageIcon origin={outcome.origin ?? info?.origin} tabUrl={tabUrl} />}
      iconIsIdentity
      tone={tone}
      expandable={allowExpand && !isStreaming && tools.length > 0}
      details={tools.length > 0 ? (
        <ul className="space-y-2">
          {tools.map((tool) => (
            <PageToolItem key={tool.name} name={tool.name} description={tool.description} />
          ))}
        </ul>
      ) : null}
      trailing={isStreaming ? <Elapsed elapsedSeconds={elapsedSeconds} stallLevel={stallLevel} /> : null}
    >
      <ToolName streaming={isStreaming && !denied} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}

export function BrowserPageToolCallBlock({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  stallLevel,
  allowExpand = true,
}: BrowserPageToolsBlockProps) {
  const { t } = useTranslation()
  const outcome = useMemo(() => parsePageToolOutcome(result, { isError, isDenied }), [result, isError, isDenied])
  const call = useMemo(() => parsePageToolCall(result), [result])
  const tabUrl = useTabUrl(params)

  const denied = outcome.status === 'denied'
  const errored = outcome.status === 'error'
  const tone = toneOf(denied, errored)

  const rawToolName = typeof params.name === 'string' ? params.name.trim() : ''
  // The page names its tools for its own authors (`request_switch_to_editor`); the row is read by
  // a person, so title-case it and keep the identifier on hover.
  const toolName = rawToolName
    ? humanizePageToolName(rawToolName)
    : t('chat.toolBlock.browser.toolsCall')
  // A page tool name is written for the page author (`add_to_cart`); the agent's own summary is
  // what the person watching can actually read, so it wins the header. Raw args move to the body.
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = pageToolInputSummary(params.input)
  // An errored call is still *this page's* call. The header keeps reading like every other page
  // tool row — favicon, name, what the agent was trying to do — and the failure is layered on:
  // the amber tone and the Error badge say it broke, the body says why. Replacing the header with
  // the error string instead loses the intent exactly when the user is trying to understand it.
  // A denial has no body worth opening (it is a decision, not an outcome), so its reason stays inline.
  const failure = errored ? outcome.message : ''
  const summary = denied
    ? outcome.message || description || inputSummary
    : description || inputSummary || failure
  const output = denied || errored ? '' : call.output.trim()
  const argsJson = useMemo(() => {
    const input = params.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
    return Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : ''
  }, [params.input])
  // When there is no description the failure already *is* the header summary; repeating it in the
  // body would just be the same sentence twice.
  const failureBody = failure && failure !== summary ? failure : ''
  const hasBody = !!failureBody || !!output

  return (
    <ToolRow
      icon={<PageIcon origin={outcome.origin ?? call.origin} tabUrl={tabUrl} />}
      iconIsIdentity
      tone={tone}
      expandable={allowExpand && !isStreaming && hasBody}
      details={hasBody ? (
        <div className="space-y-2">
          {failureBody ? <ToolErrorText>{failureBody}</ToolErrorText> : null}
          {argsJson ? (
            <div>
              <SectionLabel>{t('chat.toolBlock.browser.pageToolArguments')}</SectionLabel>
              <PrettyJSONCodeBlock text={argsJson} />
            </div>
          ) : null}
          {output ? (
            <div>
              {argsJson ? <SectionLabel>{t('chat.toolBlock.browser.result')}</SectionLabel> : null}
              <PrettyJSONCodeBlock text={output} />
            </div>
          ) : null}
        </div>
      ) : null}
      detailsClassName="px-2 pb-1.5 text-xs"
      trailing={isStreaming ? <Elapsed elapsedSeconds={elapsedSeconds} stallLevel={stallLevel} /> : null}
    >
      <ToolName streaming={isStreaming && !denied} tone={tone}>
        <span title={rawToolName || undefined}>{isStreaming ? `${toolName}…` : toolName}</span>
      </ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}
