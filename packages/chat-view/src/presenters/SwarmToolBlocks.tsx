import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, MessageSquare, Send } from 'lucide-react'
import {
  CompactLabeledToolRow,
  ToolErrorText,
  ToolName,
  ToolRow,
  ToolSummary,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

export interface SwarmToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

export interface SwarmBoardMessageEntry {
  seq: number
  agent: string
  text: string
  time?: string
  kind?: string
  channel?: string
}

function tryParseJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null
  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function pickNum(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  }
  return undefined
}

function pickStr(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

export function readBoardSummaryText(params: Record<string, unknown>, result?: string | null): string {
  const parsed = tryParseJson(result)
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : null
  const head = typeof parsed?.head === 'number' ? parsed.head : undefined
  if (messages) {
    const countLabel = messages.length === 1 ? '1 message' : `${messages.length} messages`
    return head !== undefined ? `${countLabel} · head #${head}` : countLabel
  }
  const channel = pickStr(params, ['channel', 'Channel'])
  const since = pickNum(params, ['since', 'Since'])
  const status = params.status === true || params.Status === true
  const parts: string[] = []
  if (channel) parts.push(`#${channel.replace(/^#/, '')}`)
  if (status) parts.push('status')
  if (since !== undefined) parts.push(`since #${since}`)
  return parts.join(' · ')
}

export function postMessageSummaryText(params: Record<string, unknown>, result?: string | null): string {
  const parsed = tryParseJson(result)
  const seq = typeof parsed?.seq === 'number' ? parsed.seq : undefined
  const channel = pickStr(params, ['channel', 'Channel'])
  const text = pickStr(params, ['text', 'Text', 'message', 'Message']) ?? ''
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const preview = firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine
  const prefix: string[] = []
  if (seq !== undefined) prefix.push(`#${seq}`)
  if (channel && channel !== 'main') prefix.push(`#${channel.replace(/^#/, '')}`)
  if (preview) prefix.push(preview)
  return prefix.join(' · ')
}

export function swarmWaitSummaryText(params: Record<string, unknown>): string {
  const since = pickNum(params, ['since', 'Since'])
  const mentionsOnly = params.mentions_only ?? params.mentionsOnly
  const parts: string[] = []
  if (since !== undefined) parts.push(`since #${since}`)
  if (mentionsOnly === false) parts.push('all posts')
  return parts.join(' · ')
}

export function ReadBoardToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: SwarmToolBlockPresenterProps) {
  const { t } = useTranslation()
  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied || isError)

  const parsed = useMemo(() => tryParseJson(result), [result])
  const messages = useMemo<SwarmBoardMessageEntry[]>(() => {
    if (!Array.isArray(parsed?.messages)) return []
    const out: SwarmBoardMessageEntry[] = []
    for (const item of parsed.messages) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const rec = item as Record<string, unknown>
      if (typeof rec.seq !== 'number' || typeof rec.agent !== 'string' || typeof rec.text !== 'string') continue
      out.push({
        seq: rec.seq,
        agent: rec.agent,
        text: rec.text,
        ...(typeof rec.time === 'string' ? { time: rec.time } : {}),
        ...(typeof rec.kind === 'string' ? { kind: rec.kind } : {}),
        ...(typeof rec.channel === 'string' ? { channel: rec.channel } : {}),
      })
    }
    return out
  }, [parsed])

  const summary = useMemo(() => readBoardSummaryText(params, result), [params, result])
  const label = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted,
    streamingLabel: t('chat.toolBlock.swarm.readingBoard'),
    actionLabel: t('chat.toolBlock.swarm.readBoard'),
    doneLabel: t('chat.toolBlock.swarm.boardRead'),
  })

  const hasBody = messages.length > 0 || Boolean(result && result.trim())
  const showError = Boolean(isError && !isDenied && result && messages.length === 0)

  if (!hasBody && !showError) {
    return (
      <CompactLabeledToolRow
        icon={<MessageSquare className="size-3 shrink-0 text-muted-foreground" />}
        label={withStreamingEllipsis(label, isStreaming)}
        summary={summary || undefined}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  return (
    <ToolRow
      icon={<MessageSquare className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable={allowExpand}
      details={
        showError ? (
          <ToolErrorText>{result}</ToolErrorText>
        ) : messages.length > 0 ? (
          <div className="space-y-1.5 text-xs">
            {messages.map((msg) => (
              <div key={msg.seq} className="rounded bg-background/60 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">#{msg.seq}</span>
                  <span className="font-medium text-foreground">@{msg.agent}</span>
                  {msg.channel && msg.channel !== 'main' ? (
                    <span className="rounded bg-muted px-1 font-mono text-[10px]">#{msg.channel}</span>
                  ) : null}
                  {msg.kind ? (
                    <span className="rounded bg-muted/70 px-1 text-[10px]">{msg.kind}</span>
                  ) : null}
                  {msg.time ? <span className="ml-auto font-mono text-[10px]">{msg.time}</span> : null}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-foreground/90">{msg.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{result}</div>
        )
      }
    >
      <ToolName streaming={isStreaming} tone={tone}>
        {withStreamingEllipsis(label, isStreaming)}
      </ToolName>
      {summary ? <ToolSummary title={summary}>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}

export function PostMessageToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: SwarmToolBlockPresenterProps) {
  const { t } = useTranslation()
  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied || isError)
  const text = pickStr(params, ['text', 'Text', 'message', 'Message']) ?? ''
  const parsed = useMemo(() => tryParseJson(result), [result])
  const seq = typeof parsed?.seq === 'number' ? parsed.seq : undefined
  const channel = pickStr(params, ['channel', 'Channel'])
  const summary = useMemo(() => postMessageSummaryText(params, result), [params, result])

  const label = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted,
    streamingLabel: t('chat.toolBlock.swarm.postingMessage'),
    actionLabel: t('chat.toolBlock.swarm.postMessage'),
    doneLabel: t('chat.toolBlock.swarm.messagePosted'),
  })

  const showError = Boolean(isError && !isDenied && result)
  const hasBody = Boolean(text) || showError

  if (!hasBody) {
    return (
      <CompactLabeledToolRow
        icon={<Send className="size-3 shrink-0 text-muted-foreground" />}
        label={withStreamingEllipsis(label, isStreaming)}
        summary={summary || undefined}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  return (
    <ToolRow
      icon={<Send className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable={allowExpand}
      details={
        showError ? (
          <ToolErrorText>{result}</ToolErrorText>
        ) : (
          <div className="space-y-1 text-xs">
            {(seq !== undefined || (channel && channel !== 'main')) && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {seq !== undefined ? <span className="font-mono font-medium text-foreground">#{seq}</span> : null}
                {channel && channel !== 'main' ? (
                  <span className="rounded bg-muted px-1 font-mono text-[10px]">#{channel}</span>
                ) : null}
              </div>
            )}
            <div className="whitespace-pre-wrap break-words text-foreground/90">{text}</div>
          </div>
        )
      }
    >
      <ToolName streaming={isStreaming} tone={tone}>
        {withStreamingEllipsis(label, isStreaming)}
      </ToolName>
      {summary ? <ToolSummary title={summary}>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}

export function SwarmWaitToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
}: SwarmToolBlockPresenterProps) {
  const { t } = useTranslation()
  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied || isError)
  const summary = useMemo(() => {
    const s = swarmWaitSummaryText(params)
    if (s) return s
    if (result && typeof result === 'string') {
      const line = result.trim().split(/\r?\n/, 1)[0]?.trim()
      if (line) return line
    }
    return undefined
  }, [params, result])

  const label = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted,
    streamingLabel: t('chat.toolBlock.swarm.waiting'),
    actionLabel: t('chat.toolBlock.swarm.swarmWait'),
    doneLabel: t('chat.toolBlock.swarm.waited'),
  })

  return (
    <CompactLabeledToolRow
      icon={<Clock className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(label, isStreaming)}
      summary={summary}
      streaming={isStreaming}
      tone={tone}
    />
  )
}
