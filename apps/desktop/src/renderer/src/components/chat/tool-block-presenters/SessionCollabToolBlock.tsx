import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Inbox, Send, Users } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { MarkdownView } from '../../MarkdownPreview'
import {
  ToolName,
  ToolStatusBadge,
  ToolStatusIcon,
  toolRowSurfaceClass,
  type ToolRowTone,
} from '../tool-row'

export function collabHeaderLabel(
  toolName: string,
  isStreaming: boolean,
  t: (key: string) => string,
): string {
  const isRequest = toolName === 'session_collab_request' || toolName === 'session_request_agents_collab'
  const isStart = toolName === 'session_collab_start' || toolName === 'session_start'
  const isSend = toolName === 'session_collab_send' || toolName === 'session_send'
  const isRetrieve = toolName === 'session_collab_retrieve'
    || toolName === 'session_collab_wait'
    || toolName === 'session_wait'
  if (isRequest) {
    return isStreaming
      ? t('chat.toolBlock.collab.requestingCollaboration')
      : t('chat.toolBlock.collab.collaborationRequested')
  }
  if (isStart) {
    return isStreaming
      ? t('chat.toolBlock.collab.startingCollaborationSession')
      : t('chat.toolBlock.collab.collaborationSessionStarted')
  }
  if (isSend) {
    return isStreaming
      ? t('chat.toolBlock.collab.sendingMessage')
      : t('chat.toolBlock.collab.messageSent')
  }
  if (isRetrieve) {
    return isStreaming
      ? t('chat.toolBlock.collab.retrievingMessages')
      : t('chat.toolBlock.collab.messagesRetrieved')
  }
  return toolName.replace(/_/g, ' ')
}

export const COLLAB_TOOLS = new Set([
  'session_collab_request',
  'session_collab_start',
  'session_collab_send',
  'session_collab_retrieve',
  // Legacy names (in case older transcripts still reference them)
  'session_request_agents_collab',
  'session_start',
  'session_send',
  'session_wait',
  'session_collab_wait',
])

function parseCollabResult(result: string | null | undefined): Record<string, unknown> | null {
  if (!result) return null
  try {
    const parsed = JSON.parse(result) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function nameRoleLabel(name: string, role: string): string {
  const n = name.trim() || 'Agent'
  const r = role.trim()
  return r ? `${n} - ${r}` : n
}

function peerTitleFromRecord(rec: Record<string, unknown> | null | undefined): string {
  if (!rec) return ''
  if (typeof rec.title === 'string' && rec.title.trim()) return rec.title.trim()
  const name = typeof rec.name === 'string' ? rec.name : ''
  const role = typeof rec.role === 'string' ? rec.role : ''
  return nameRoleLabel(name, role)
}

function peerSessionIdFromRecord(rec: Record<string, unknown> | null | undefined): string | undefined {
  if (!rec) return undefined
  return typeof rec.sessionId === 'string' && rec.sessionId.trim()
    ? rec.sessionId.trim()
    : undefined
}

/** Clickable session title — navigation is supplied by the host adapter. */
function SessionTitleLink({
  sessionId,
  children,
  className,
  onOpenSession,
}: {
  sessionId?: string
  children: ReactNode
  className?: string
  onOpenSession: (sessionId: string) => void | Promise<void>
}) {
  if (!sessionId) {
    return <span className={className}>{children}</span>
  }
  return (
    <button
      type="button"
      className={cn(
        'min-w-0 truncate text-left hover:text-primary hover:underline',
        className,
      )}
      title={typeof children === 'string' ? children : undefined}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void onOpenSession(sessionId)
      }}
    >
      {children}
    </button>
  )
}

/** Prefer agent-chosen `name` (never harness brand). */
function launchNameRole(launch: Record<string, unknown>): string {
  const config = launch.config && typeof launch.config === 'object'
    ? launch.config as Record<string, unknown>
    : null
  const name = typeof launch.name === 'string' && launch.name.trim()
    ? launch.name.trim()
    : typeof config?.name === 'string' && config.name.trim()
      ? config.name.trim()
      : typeof launch.launchId === 'string' && launch.launchId.length <= 32
        ? launch.launchId
        : 'Agent'
  const role = typeof launch.role === 'string'
    ? launch.role.trim()
    : typeof config?.role === 'string'
      ? String(config.role).trim()
      : 'Agent'
  return nameRoleLabel(name, role)
}

function requestSummary(
  launches: unknown[],
  resultLaunches: unknown[] | null,
  agentCountLabel: (count: number) => string,
): string {
  const source = (resultLaunches && resultLaunches.length > 0 ? resultLaunches : launches)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  if (source.length === 0) return ''
  if (source.length === 1) return launchNameRole(source[0])
  return agentCountLabel(source.length)
}

/** Markdown preview; collapsed by max-height (~3 lines), expand for full body. */
function CollabMessageBody({ content }: { content: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const textRef = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState(false)

  useLayoutEffect(() => {
    if (open) {
      setClamped(false)
      return
    }
    const el = textRef.current
    if (!el) return
    setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [content, open])

  return (
    <div className="min-w-0">
      <div
        ref={textRef}
        role={clamped || open ? 'button' : undefined}
        tabIndex={clamped || open ? 0 : undefined}
        className={cn(
          'min-w-0 break-words text-foreground',
          // max-height clamps block Markdown (line-clamp fails on nested block elements)
          !open && 'max-h-[10.5em] overflow-hidden',
          (clamped || open) && 'cursor-pointer',
        )}
        onClick={(e) => {
          if (!clamped && !open) return
          // Keep link / code selection clicks from toggling collapse
          if ((e.target as HTMLElement).closest('a, button, pre, code')) return
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if ((!clamped && !open) || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MarkdownView
          content={content}
          className="!p-0 !py-0 text-xs leading-relaxed [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-1.5 [&_blockquote]:my-1 first:[&>*]:mt-0 last:[&>*]:mb-0"
        />
      </div>
      {(clamped || open) && (
        <button
          type="button"
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open
            ? t('chat.toolBlock.collab.showLessMessage')
            : t('chat.toolBlock.collab.showFullMessage')}
        </button>
      )}
    </div>
  )
}

type CollabDetailRow = { label: string; value: string; sessionId?: string }
type CollabInboxMessage = {
  from?: string
  fromSessionId?: string
  to?: string
  toSessionId?: string
  content: string
}

export function SessionCollabToolBlock({
  toolName,
  params,
  result,
  isStreaming,
  onOpenSession,
}: {
  toolName: string
  params: Record<string, unknown>
  result: string | null | undefined
  isStreaming: boolean
  onOpenSession: (sessionId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const parsed = parseCollabResult(result)
  const status = typeof parsed?.status === 'string' ? parsed.status : ''

  let Icon: typeof Users | typeof Send | typeof Inbox = Users
  let label = toolName
  /** Plain summary when no session link is available. */
  let summary = ''
  /** Optional peer title + session id for clickable navigation in the header. */
  let summaryPeer: { title: string; sessionId?: string } | null = null
  /** Optional trailing text after the peer title (e.g. send prompt). */
  let summarySuffix = ''
  let detailRows: CollabDetailRow[] = []
  /** Retrieve success: message cards with clampable bodies. */
  let inboxMessages: CollabInboxMessage[] = []
  let expandable = false
  /** When start succeeds, header title can jump to the new session. */
  let headerSessionId: string | undefined

  const isRequest = toolName === 'session_collab_request' || toolName === 'session_request_agents_collab'
  const isStart = toolName === 'session_collab_start' || toolName === 'session_start'
  const isSend = toolName === 'session_collab_send' || toolName === 'session_send'
  const isRetrieve = toolName === 'session_collab_retrieve'
    || toolName === 'session_collab_wait'
    || toolName === 'session_wait'

  if (isRequest) {
    Icon = Users
    const inputLaunches = Array.isArray(params.launches) ? params.launches : []
    const resultLaunches = Array.isArray(parsed?.launches) ? parsed.launches : null
    summary = requestSummary(
      inputLaunches,
      resultLaunches,
      (count) => t('chat.toolBlock.collab.agentCount', { count }),
    )
    if (isStreaming) {
      label = t('chat.toolBlock.collab.requestingCollaboration')
    } else if (status === 'cancelled') {
      label = t('chat.toolBlock.settingsChangeCancelled')
    } else if (status === 'rejected') {
      label = t('chat.toolBlock.settingsChangeRejected')
    } else {
      label = t('chat.toolBlock.collab.collaborationRequested')
    }
  } else if (isStart) {
    Icon = Users
    const name = typeof parsed?.name === 'string' ? parsed.name : ''
    const role = typeof parsed?.role === 'string' ? parsed.role : ''
    const title = typeof parsed?.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : nameRoleLabel(name, role)
    const sid = typeof parsed?.sessionId === 'string' ? parsed.sessionId : undefined
    if (title) {
      summaryPeer = { title, sessionId: sid }
      headerSessionId = sid
    } else {
      summary = t('chat.toolBlock.collab.agentSession')
    }
    label = isStreaming
      ? t('chat.toolBlock.collab.startingCollaborationSession')
      : t('chat.toolBlock.collab.collaborationSessionStarted')
    if (parsed?.reused === true) {
      summarySuffix = t('chat.toolBlock.collab.reused')
    }
    const config = parsed?.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)
      ? parsed.config as Record<string, unknown>
      : null
    if (config && !isStreaming) {
      expandable = true
      if (typeof config.name === 'string' && config.name) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.name'), value: config.name })
      }
      if (typeof config.role === 'string' && config.role) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.role'), value: config.role })
      }
      if (typeof config.model === 'string' && config.model) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.model'), value: config.model })
      }
      if (typeof config.effort === 'string' && config.effort) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.effort'), value: config.effort })
      }
      if (typeof config.permissionMode === 'string' && config.permissionMode) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.permission'), value: config.permissionMode })
      }
      if (typeof config.sandboxMode === 'string' && config.sandboxMode) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.sandbox'), value: config.sandboxMode })
      }
      if (typeof config.cwd === 'string' && config.cwd) {
        detailRows.push({ label: t('chat.toolBlock.collab.fields.cwd'), value: config.cwd })
      }
      if (sid) {
        detailRows.push({
          label: t('chat.toolBlock.collab.fields.sessionId'),
          value: sid,
          sessionId: sid,
        })
      }
    }
  } else if (isSend) {
    Icon = Send
    const to = parsed?.to && typeof parsed.to === 'object' && !Array.isArray(parsed.to)
      ? parsed.to as Record<string, unknown>
      : null
    const peer = peerTitleFromRecord(to)
    const peerSid = peerSessionIdFromRecord(to)
      ?? (typeof parsed?.peerSessionId === 'string' ? parsed.peerSessionId : undefined)
    // Header: label + peer only — message body lives in the expandable panel.
    if (peer) {
      summaryPeer = { title: peer, sessionId: peerSid }
    }
    label = isStreaming
      ? t('chat.toolBlock.collab.sendingMessage')
      : t('chat.toolBlock.collab.messageSent')
    const content = String(params.content ?? '')
    if (content && !isStreaming) {
      expandable = true
      inboxMessages = [{
        to: peer || undefined,
        toSessionId: peerSid,
        content,
      }]
    }
  } else if (isRetrieve) {
    Icon = Inbox
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : []
    // Optional remaining-in-mailbox count (legacy wait / future fields). Hide when 0.
    const remainingRaw = parsed?.remaining
    const remaining = typeof remainingRaw === 'number' && Number.isFinite(remainingRaw)
      ? Math.max(0, Math.floor(remainingRaw))
      : null

    if (isStreaming) {
      label = t('chat.toolBlock.collab.retrievingMessages')
      summary = ''
    } else if (status === 'empty' || status === 'timeout' || messages.length === 0) {
      // `timeout` kept for legacy session_collab_wait transcripts
      label = t('chat.toolBlock.collab.noMessages')
      // Don't surface "0 remaining" — empty inbox is already the label.
      summary = remaining != null && remaining > 0
        ? t('chat.toolBlock.collab.remainingCount', { count: remaining })
        : ''
    } else {
      // Lead with how many messages arrived this retrieve — not peer count / remaining.
      label = t('chat.toolBlock.collab.receivedMessageCount', { count: messages.length })
      summary = remaining != null && remaining > 0
        ? t('chat.toolBlock.collab.remainingCount', { count: remaining })
        : ''
      expandable = true
      inboxMessages = messages.map((raw) => {
        const msg = raw as Record<string, unknown>
        const fromRec = msg.from && typeof msg.from === 'object'
          ? msg.from as Record<string, unknown>
          : null
        return {
          from: peerTitleFromRecord(fromRec) || undefined,
          fromSessionId: peerSessionIdFromRecord(fromRec)
            ?? (typeof msg.fromSessionId === 'string' ? msg.fromSessionId : undefined),
          content: typeof msg.content === 'string' ? msg.content : '',
        }
      })
    }
  }

  const streamingDots = isStreaming && !/[.…]$/.test(label) ? '…' : ''
  const collabTone: ToolRowTone =
    status === 'rejected' || status === 'cancelled' ? 'denied' : 'default'
  const header = (
    <>
      <ToolStatusIcon
        tone={collabTone}
        fallback={<Icon className="size-3 shrink-0 text-muted-foreground" />}
      />
      <ToolName streaming={isStreaming} tone={collabTone}>
        {label}{streamingDots}
      </ToolName>
      {summaryPeer && (
        <SessionTitleLink
          sessionId={summaryPeer.sessionId ?? headerSessionId}
          className="min-w-0 shrink truncate text-muted-foreground"
          onOpenSession={onOpenSession}
        >
          {summaryPeer.title}
        </SessionTitleLink>
      )}
      {summary && !summaryPeer && (
        <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
      )}
      {summarySuffix && (
        <span className="min-w-0 truncate text-muted-foreground">{summarySuffix}</span>
      )}
      <ToolStatusBadge tone={collabTone} />
    </>
  )

  const hasExpandBody = expandable && (detailRows.length > 0 || inboxMessages.length > 0)
  if (!hasExpandBody) {
    return (
      <div className={toolRowSurfaceClass(collabTone)}>
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">{header}</div>
      </div>
    )
  }

  return (
    <div className={toolRowSurfaceClass(collabTone, true)}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((value) => !value)}
      >
        {header}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {inboxMessages.length > 0 ? (
            <div className="space-y-2 border-t border-border/40 px-2 py-2 text-xs">
              {inboxMessages.map((msg, index) => (
                <div
                  key={`${msg.fromSessionId ?? msg.toSessionId ?? msg.from ?? msg.to ?? 'msg'}-${index}`}
                  className={cn(
                    'space-y-1',
                    index > 0 && 'border-t border-border/30 pt-2',
                  )}
                >
                  {msg.to && (
                    <div className="flex items-baseline gap-2">
                      <span className="w-12 shrink-0 text-muted-foreground">
                        {t('chat.toolBlock.collab.fields.to')}
                      </span>
                      <SessionTitleLink
                        sessionId={msg.toSessionId}
                        className="min-w-0 flex-1 break-words font-medium text-foreground"
                        onOpenSession={onOpenSession}
                      >
                        {msg.to}
                      </SessionTitleLink>
                    </div>
                  )}
                  {msg.from && (
                    <div className="flex items-baseline gap-2">
                      <span className="w-12 shrink-0 text-muted-foreground">
                        {t('chat.toolBlock.collab.fields.from')}
                      </span>
                      <SessionTitleLink
                        sessionId={msg.fromSessionId}
                        className="min-w-0 flex-1 break-words font-medium text-foreground"
                        onOpenSession={onOpenSession}
                      >
                        {msg.from}
                      </SessionTitleLink>
                    </div>
                  )}
                  {msg.content ? <CollabMessageBody content={msg.content} /> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1 border-t border-border/40 px-2 py-2 text-xs">
              {detailRows.map((row) => (
                <div key={`${row.label}:${row.value.slice(0, 24)}`} className="flex items-baseline gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">{row.label}</span>
                  {row.sessionId ? (
                    <SessionTitleLink
                      sessionId={row.sessionId}
                      className="min-w-0 flex-1 break-words text-foreground"
                      onOpenSession={onOpenSession}
                    >
                      {row.value}
                    </SessionTitleLink>
                  ) : (
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">{row.value}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
