import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, PenLine, Check, X, Ban, TriangleAlert, Upload, Smartphone, SlidersHorizontal, Users, Send, Inbox } from 'lucide-react'
import { diffLines } from 'diff'
import { cn } from '@superone/ui/lib/utils'
import type { ConfigFieldType } from '@superone/shared/agent-types'
import { diffConfigFieldValue, formatConfigFieldValue } from '@/lib/config-field-summary'
import { inferLanguage, useHighlightedTokens, useIncrementalHighlightedLines, type DiffLine, DiffView, splitContentLines, buildUnifiedFileChangeDiffLines } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useChatStore, useActiveSession, useBashOutput, useShareProgress } from '@/stores/chat'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { useSettingsStore } from '@/stores/settings'
import { useSourceControlStore } from '@/stores/source-control'
import { useAppStore } from '@/stores/app'
import { ToolIcon } from './ToolIcon'
import { DraggableFileIcon } from './DraggableFileIcon'
import { getToolDisplay, getToolLabel, getToolVerb, parseToolInput, parseMcpToolName, isHiddenToolBlock, formatReadMeta, type ToolIcon as ToolIconType } from './tool-display'
import { isWorkflowSmokeCheck } from './workflow-utils'
import { PrettyJSONCodeBlock, AskUserQuestionResult } from './tool-result-views'
import { BrowserToolBlock } from './BrowserToolBlock'
import { ComputerUseToolBlock } from './ComputerUseToolBlock'
import { MediaProvidersBlock } from './MediaProvidersBlock'
import { VideoGenToolBlock } from './VideoGenToolBlock'
import { getBrowserOp } from './browser-tool-display'
import { getComputerOp } from './computer-tool-display'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { AnsiText } from '@/lib/ansi'
import { countUnifiedDiffDelta, countPrefixedDiffDelta, computeLineDelta, computeStreamingEditDelta, tryPrettifyJson, extractToolError } from './tool-block-utils'
import { WidgetBlock } from './WidgetBlock'
import { useNestedToolDefaults } from './nested-tool-context'
import { CanvasEditDiff } from './CanvasEditDiff'
import { RollingNumber } from './RollingNumber'
import { parseWidgetResult, parsePartialWidgetInput } from '@superone/shared/generative-ui/types'
import { ToolRendererFrame } from './ToolRendererFrame'
import { StandaloneToolBlock } from './StandaloneToolBlock'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'
import { resolveMiniAppToolIdentity } from '@/lib/miniapp-tool-identity'
import { clickReleasedOnSelection, parseFileLinkTarget } from '@/lib/file-link'
import { TerminalCommandOutput } from './TerminalCommandOutput'
import { MarkdownView } from '@/components/MarkdownPreview'
import {
  isSessionArchiveToolName,
  SessionArchiveToolBlock,
} from './SessionArchiveToolBlock'
import {
  isAutomationToolName,
  AutomationToolBlock,
} from './AutomationToolBlock'

function isCompleteJson(s: string): boolean {
  try { JSON.parse(s); return true } catch { return false }
}

const SUPERONE_SERVER = 'superone'

function CompactToolRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="tool-node my-0.5 min-w-0 rounded bg-muted/20">
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs">
        {icon}
        {children}
      </div>
    </div>
  )
}

const COLLAB_TOOLS = new Set([
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

/** Clickable session title — navigates via chat store switchSession. */
function SessionTitleLink({
  sessionId,
  children,
  className,
}: {
  sessionId?: string
  children: ReactNode
  className?: string
}) {
  const switchSession = useChatStore((s) => s.switchSession)
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
        void switchSession(sessionId)
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

function SessionCollabToolBlock({
  toolName,
  params,
  result,
  isStreaming,
}: {
  toolName: string
  params: Record<string, unknown>
  result: string | null | undefined
  isStreaming: boolean
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
      ? t('chat.toolBlock.collab.sendingMessageTo')
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
  const header = (
    <>
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium text-foreground">
        {label}{streamingDots}
      </span>
      {summaryPeer && (
        <SessionTitleLink
          sessionId={summaryPeer.sessionId ?? headerSessionId}
          className="min-w-0 shrink truncate text-muted-foreground"
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
    </>
  )

  const hasExpandBody = expandable && (detailRows.length > 0 || inboxMessages.length > 0)
  if (!hasExpandBody) {
    return (
      <div className="tool-node my-0.5 rounded bg-muted/20">
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">{header}</div>
      </div>
    )
  }

  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
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

function AppToolHeader({ appName, toolText, isStreaming, summary }: { appName?: string; toolText: string; isStreaming: boolean; summary: string }) {
  return (
    <>
      {appName && <><span className="shrink-0 font-medium text-foreground">{appName}</span><span className="shrink-0 text-muted-foreground">·</span></>}
      <span className="shrink-0 text-foreground">{isStreaming ? <>{toolText}…</> : toolText}</span>
      {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
    </>
  )
}

function AppToolBlock({ icon, appName, toolText, summary, isStreaming, expandable, result }: {
  icon: React.ReactNode
  appName?: string
  toolText: string
  summary: string
  isStreaming: boolean
  expandable: boolean
  result?: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (!expandable) {
    return (
      <CompactToolRow icon={icon}>
        <AppToolHeader appName={appName} toolText={toolText} isStreaming={isStreaming} summary={summary} />
      </CompactToolRow>
    )
  }
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {icon}
        <AppToolHeader appName={appName} toolText={toolText} isStreaming={isStreaming} summary={summary} />
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-1.5">
            <PrettyJSONCodeBlock text={result!} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SetupMiniAppDevBlock({ appName, isStreaming, params, result }: {
  appName: string
  isStreaming: boolean
  params: Record<string, unknown>
  result: Record<string, unknown> | null
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const errored = !!result && result.status === 'error'
  const headerLabel = errored
    ? t('chat.toolBlock.setUpMiniAppFailed')
    : isStreaming
      ? t('chat.toolBlock.settingUpMiniApp')
      : t('chat.toolBlock.setUpMiniApp')
  const appId = result?.appId ? String(result.appId) : ''
  const directory = params.directory ? String(params.directory) : ''
  const description = params.description ? String(params.description) : ''
  const errorMsg = errored ? String((result?.message as string | undefined) ?? '') : ''
  const rows: Array<{ key: string; label: string; value: string; mono?: boolean }> = []
  if (appId) rows.push({ key: 'appId', label: t('chat.toolBlock.setupFields.appId'), value: appId, mono: true })
  if (directory) rows.push({ key: 'directory', label: t('chat.toolBlock.setupFields.directory'), value: directory, mono: true })
  if (description) rows.push({ key: 'description', label: t('chat.toolBlock.setupFields.description'), value: description })
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        <ToolIcon icon="file-plus" className={cn('size-3 shrink-0', errored ? 'text-destructive' : 'text-muted-foreground')} />
        <span className="shrink-0 font-medium text-foreground">{headerLabel}{isStreaming && '…'}</span>
        {appName && <>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span className="min-w-0 truncate text-foreground">{appName}</span>
        </>}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 border-t border-border/40 px-2 py-2 text-xs">
            {errorMsg && (
              <div className="mb-2 rounded bg-destructive/10 px-2 py-1.5 text-destructive">
                {errorMsg}
              </div>
            )}
            {rows.map(({ key, label, value, mono }) => (
              <div key={key} className="flex items-baseline gap-2">
                <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                <span className={cn('min-w-0 flex-1 break-all text-foreground', mono && 'font-mono')}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

type ConfigAppliedChange = { key?: string; label?: string; type?: ConfigFieldType; oldValue?: unknown; newValue?: unknown }

function ConfigApplyBlock({ params, result, isStreaming, isError, isDenied }: {
  params: Record<string, unknown>
  result: string | null
  isStreaming: boolean
  isError: boolean
  isDenied: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const emptyLabel = t('chat.configConfirm.emptyValue')

  const parsed = useMemo<Record<string, unknown> | null>(() => {
    if (!result) return null
    try {
      const p = JSON.parse(result)
      return p && typeof p === 'object' ? (p as Record<string, unknown>) : null
    } catch {
      return null
    }
  }, [result])

  const status = typeof parsed?.status === 'string' ? (parsed.status as string) : undefined

  const rows = useMemo(() => {
    const applied = Array.isArray(parsed?.applied) ? (parsed.applied as ConfigAppliedChange[]) : null
    if (applied?.length) {
      return applied.map((a) => {
        const type = a.type ?? 'string'
        const diff = 'oldValue' in a ? diffConfigFieldValue(type, a.oldValue, a.newValue) : null
        return {
          key: String(a.key ?? ''),
          label: a.label ?? String(a.key ?? ''),
          diff,
          from: diff || !('oldValue' in a) ? null : formatConfigFieldValue(type, a.oldValue, emptyLabel),
          to: diff ? null : formatConfigFieldValue(type, a.newValue, emptyLabel),
        }
      })
    }
    const changes = Array.isArray(params.changes) ? (params.changes as Array<{ key?: string; value?: unknown }>) : null
    if (changes) {
      return changes.map((c) => ({
        key: String(c.key ?? ''),
        label: String(c.key ?? ''),
        diff: null,
        from: null,
        to: formatConfigFieldValue('string', c.value, emptyLabel),
      }))
    }
    return []
  }, [parsed, params, emptyLabel])

  const resourceReq = params.resource && typeof params.resource === 'object' ? (params.resource as { operation?: string }) : undefined
  const resourceOp = typeof parsed?.operation === 'string' ? (parsed.operation as string) : resourceReq?.operation
  const resourceTitle = typeof parsed?.title === 'string' ? (parsed.title as string) : undefined

  const failed = isError || isDenied || status === 'error'
  const rejected = status === 'rejected'
  const cancelled = status === 'cancelled'
  const muted = failed || rejected || cancelled

  let headerLabel: string
  if (isStreaming) headerLabel = t('chat.toolBlock.applyingSettings')
  else if (failed) headerLabel = t('chat.toolBlock.settingsChangeFailed')
  else if (rejected) headerLabel = t('chat.toolBlock.settingsChangeRejected')
  else if (cancelled) headerLabel = t('chat.toolBlock.settingsChangeCancelled')
  else if (resourceOp === 'delete') headerLabel = t('chat.toolBlock.configDeleted')
  else if (resourceOp === 'create') headerLabel = t('chat.toolBlock.configCreated')
  else if (resourceOp === 'update') headerLabel = t('chat.toolBlock.configUpdated')
  else headerLabel = t('chat.toolBlock.appliedSettings')

  const summary = resourceTitle ?? (rows.length > 0 ? t('chat.toolBlock.settingsChangeCount', { count: rows.length }) : '')
  const errorMsg = failed && typeof parsed?.message === 'string' ? (parsed.message as string) : ''
  const expandable = rows.length > 0 || !!errorMsg

  return (
    <div className={cn('tool-node my-0.5 rounded', muted ? 'bg-muted/10' : 'bg-muted/20', expandable && 'cursor-pointer', expandable && 'hover:bg-muted/40')}>
      <div
        className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        <SlidersHorizontal className={cn('size-3 shrink-0', failed ? 'text-destructive' : 'text-muted-foreground')} />
        <span className="shrink-0 font-medium text-foreground">{headerLabel}{isStreaming && '…'}</span>
        {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
        {expandable && <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />}
      </div>
      {expandable && (
        <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}>
          <div className="overflow-hidden">
            <div className="space-y-1.5 border-t border-border/40 px-2 py-2 text-xs">
              {errorMsg && <div className="mb-1 rounded bg-destructive/10 px-2 py-1.5 text-destructive">{errorMsg}</div>}
              {rows.map((r) => (
                <div key={r.key} className="flex items-baseline gap-2">
                  <span className="w-32 shrink-0 truncate text-muted-foreground" title={r.label}>{r.label}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1.5">
                    {r.diff ? (
                      <span className="break-all font-medium text-foreground">{r.diff}</span>
                    ) : (
                      <>
                        {r.from !== null && (
                          <>
                            <span className="text-muted-foreground/60 line-through">{r.from}</span>
                            <span className="text-muted-foreground/50">→</span>
                          </>
                        )}
                        <span className="break-all font-medium text-foreground">{r.to}</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AppResultRendererBlock({ appId, toolUseId, toolName, appName, toolReadableName, summary, icon, templatePath, result, autoExpand }: {
  appId: string
  toolUseId: string
  toolName: string
  appName?: string
  toolReadableName: string
  summary: string
  icon: React.ReactNode
  templatePath: string
  result: unknown
  autoExpand: boolean
}) {
  const [expanded, setExpanded] = useState(autoExpand)
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {icon}
        <AppToolHeader appName={appName} toolText={toolReadableName} isStreaming={false} summary={summary} />
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-1.5">
            {expanded && (
              <ToolRendererFrame
                phase="result"
                appId={appId}
                callId={toolUseId}
                toolName={toolName}
                templatePath={templatePath}
                result={result}
                onClose={() => setExpanded(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Dev-only: comma-separated tool names to show raw debug UI. e.g. RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

interface ToolBlockProps {
  toolName: string
  toolUseId?: string
  input: string
  /** Precomputed summary from ACP/main (e.g. Grok title / raw_output query). */
  toolSummary?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isTimedOut?: boolean
  isError?: boolean
  resultOutputPath?: string
  autoExpand?: boolean
  backgroundActivity?: boolean
  grouped?: boolean
  trailingAction?: ReactNode
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'FileChange'])
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])



export const ToolBlock = memo(function ToolBlock({ toolName, toolUseId, input, toolSummary, status, elapsedSeconds, result, isTimedOut, isError, resultOutputPath, autoExpand, backgroundActivity = false, grouped = false, trailingAction }: ToolBlockProps) {
  const { t } = useTranslation()
  const nestedDefaults = useNestedToolDefaults()
  const autoExpandFileDiffs = useAppStore((s) => s.autoExpandFileDiffs)
  // Subagent card nests tools with allowExpand:false (header-only rows). Full view omits it.
  const allowExpand = nestedDefaults?.allowExpand !== false
  // Bash and other non-diff tools keep the historical default of auto-expand.
  // File diffs (Edit/Write/FileChange) honor the user setting (default: off).
  const effectiveAutoExpand = allowExpand && (autoExpand ?? nestedDefaults?.defaultAutoExpand ?? true)
  const shouldAutoExpandDiff = allowExpand && (autoExpand ?? nestedDefaults?.defaultAutoExpand ?? autoExpandFileDiffs)
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const streamingInputPreview = useActiveSession((s) => toolUseId ? s._streamingToolInputPreviews[toolUseId] : undefined)
  const toolInterceptState = useChatStore((s) =>
    toolUseId ? Object.values(s.toolRenderers).find((r) => r.toolUseId === toolUseId && r.status === 'awaiting') : undefined,
  )
  const parsedParams = useMemo(() => parseToolInput(input, toolName), [input, toolName])
  const isStreaming = status === 'streaming'
  const params = isStreaming && streamingInputPreview ? streamingInputPreview : parsedParams
  const display = useMemo(() => getToolDisplay(toolName, params, cwd, homedir), [toolName, params, cwd, homedir])
  const mcpInfo = parseMcpToolName(toolName)
  const isMcp = mcpInfo !== null
  const mcpMeta = useSettingsStore((s) => s.mcpMeta)
  const mcpLibrary = useSettingsStore((s) => s.mcpLibrary)
  const mcpIconSrc = isMcp
    ? (mcpMeta[mcpInfo.serverName]?.icons?.[0]?.src
      ?? mcpLibrary.find((e) => e.name === mcpInfo.serverName)?.icons?.[0]?.src)
    : undefined
  const stallLevel = useStallLevel(isStreaming)
  const fileToolPath = FILE_PATH_TOOLS.has(toolName) ? String(params.file_path ?? params.notebook_path ?? '') : ''
  const fileToolName = fileToolPath ? fileToolPath.split('/').pop() || '' : ''
  const miniApps = useMiniAppStore((s) => s.apps)

  const isDenied = !!result && result.startsWith('[denied] ')
  const cleanResult = isDenied ? result.slice('[denied] '.length) : result
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
    if (isStreaming && toolName === 'Edit') {
      if (!('new_string' in params)) return null
      return computeStreamingEditDelta(String(params.old_string ?? ''), String(params.new_string ?? ''))
    }
    return computeLineDelta(toolName, params)
  }, [toolName, params, isDenied, isError, isStreaming])
  const hasStreamingDiffContent = DIFF_TOOLS.has(toolName) && isStreaming && (
    toolName === 'Edit'
      ? String(params.new_string ?? '').length > 0 || String(params.old_string ?? '').length > 0
      : toolName === 'Write'
        ? String(params.content ?? '').length > 0
        : String(params.diff ?? '').length > 0
  )
  const hasCompleteDiff = DIFF_TOOLS.has(toolName) && !isStreaming && !isDenied && !isError && (
    toolName === 'FileChange'
      ? String(params.diff ?? '').length > 0
      : Object.keys(params).length > 0
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

  // Debug mode (dev only): highest priority — show raw input/output for matching tools
  // Set RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate to enable
  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => toolName.toLowerCase().includes(n))
  if (isDebug) {
    return <DebugToolBlock toolName={toolName} input={input} result={result} status={status} elapsedSeconds={elapsedSeconds} />
  }

  if (isHiddenToolBlock(toolName, result)) return null

  const isQuestionDismissed = toolName === 'AskUserQuestion' && !!result && (isDenied || result.includes('dismissed'))

  if (toolName === 'Bash') {
    const timeout = typeof params.timeout === 'number' ? params.timeout : undefined
    const runInBackground = params.run_in_background === true || params.background === true
    const description = typeof params.description === 'string' ? params.description : undefined
    return (
      <BashTerminalView
        toolUseId={toolUseId ?? ''}
        command={display.summary}
        description={description}
        fallbackResult={isDenied ? undefined : (result ?? undefined)}
        isStreaming={isStreaming}
        isDenied={isDenied}
        isError={isError}
        timeoutMs={timeout}
        isTimedOut={isTimedOut}
        resultOutputPath={resultOutputPath}
        runInBackground={runInBackground}
        autoExpand={effectiveAutoExpand}
        allowExpand={allowExpand}
        backgroundActivity={backgroundActivity}
        trailingAction={trailingAction}
      />
    )
  }

  if (toolName === 'EnterPlanMode') {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-primary" />
        <span className="font-medium text-primary">{t('chat.toolBlock.enteredPlanMode')}</span>
      </div>
    )
  }
  if (toolName === 'ExitPlanMode') {
    return <ExitPlanModeBlock result={result} />
  }
  const hasResult = !!cleanResult && !isStreaming && !isDenied && toolName !== 'Read' && toolName !== 'Skill' && toolName !== 'AskUserQuestion'
  const hasQA = toolName === 'AskUserQuestion' && !!cleanResult && !isStreaming && !isQuestionDismissed
  const expandable = allowExpand && (hasDiff || hasResult || hasQA)

  // Prefer parsed input summary; fall back to ACP/main toolSummary (Grok title / raw_output).
  const summary = display.summary
    || (toolSummary?.trim() ?? '')
    || (!isMcp && display.icon === 'wrench' && input.length > 0
      ? (input.length > 80 ? input.slice(0, 80) + '\u2026' : input)
      : '')

  const displayName = mcpInfo
    ? <>{mcpInfo.serverName}<span className="text-muted-foreground"> · </span>{mcpInfo.mcpToolName.replace(/_/g, ' ')}</>
    : toolName === 'Workflow' && isWorkflowSmokeCheck(params)
      ? 'Smoke check'
      : getToolLabel(toolName)

  if (mcpInfo?.serverName === SUPERONE_SERVER) {
    const browserOp = getBrowserOp(mcpInfo.mcpToolName, params)
    if (browserOp) {
      return (
        <BrowserToolBlock
          op={browserOp}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          elapsedSeconds={elapsedSeconds}
          stallLevel={stallLevel}
          allowExpand={allowExpand}
        />
      )
    }
    const computerOp = getComputerOp(mcpInfo.mcpToolName)
    if (computerOp) {
      return (
        <ComputerUseToolBlock
          op={computerOp}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          elapsedSeconds={elapsedSeconds}
          stallLevel={stallLevel}
          allowExpand={allowExpand}
        />
      )
    }
    const superoneToolDisplay: Record<string, { icon: ToolIconType; streaming: string; done: string; summaryField?: string }> = {
      media_list_providers: { icon: 'image', streaming: t('chat.toolBlock.listingMediaProviders'), done: t('chat.toolBlock.listedMediaProviders') },
      media_generate_image: { icon: 'image', streaming: t('chat.toolBlock.generatingImage'), done: t('chat.toolBlock.generatedImage'), summaryField: 'prompt' },
    }
    if (mcpInfo.mcpToolName === 'miniapp_dev_pack') {
      const appDir = String(params.appDir ?? '')
      const outputDir = String(params.outputDir ?? '')
      const packApp = appDir ? miniApps.find((a) => a.distDir === appDir || a.installDir === appDir) : undefined
      const s1appName = packApp ? `${packApp.manifest.appId}-${packApp.manifest.version}.s1app` : null
      return (
        <CompactToolRow icon={<ToolIcon icon="package" className="size-3 shrink-0 text-muted-foreground" />}>
          {isStreaming ? (
            <>
              <span className="font-medium text-foreground">{t('chat.toolBlock.packing')}</span>
              {packApp && <MiniAppIcon appId={packApp.id} className="size-3.5 shrink-0" />}
              <span className="text-muted-foreground">{packApp?.manifest.name ?? appDir.split('/').pop()}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{t('chat.toolBlock.miniAppPacked')}</span>
              {s1appName && <>
                <span className="text-muted-foreground">:</span>
                <button className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); window.app.showInFolder(outputDir, s1appName) }}>{s1appName}</button>
              </>}
            </>
          )}
        </CompactToolRow>
      )
    }
    if (mcpInfo.mcpToolName === 'mobile_share_file') {
      return <MobileShareFileBlock params={params} result={!isStreaming ? (result ?? null) : null} isStreaming={isStreaming} />
    }
    if (mcpInfo.mcpToolName === 'config_apply') {
      return (
        <ConfigApplyBlock
          params={params}
          result={!isStreaming ? (result ?? null) : null}
          isStreaming={isStreaming}
          isError={!!isError}
          isDenied={isDenied}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'config_read') {
      const hasDomain = typeof params.domain === 'string' && params.domain.length > 0
      let domainLabel = ''
      if (!isStreaming && result) {
        try {
          const parsed = JSON.parse(result)
          if (parsed && typeof parsed === 'object' && typeof parsed.label === 'string') domainLabel = parsed.label
        } catch { /* ignore */ }
      }
      const summaryValue = domainLabel || (hasDomain ? '' : t('chat.toolBlock.guideOverview'))
      return (
        <CompactToolRow icon={<ToolIcon icon="book-open" className="size-3 shrink-0 text-muted-foreground" />}>
          <span className="font-medium text-foreground">
            {isStreaming ? <>{t('chat.toolBlock.readingConfig')}…</> : t('chat.toolBlock.readConfig')}
            {summaryValue && <>: <span className="text-muted-foreground">{summaryValue}</span></>}
          </span>
        </CompactToolRow>
      )
    }
    if (mcpInfo.mcpToolName === 'read_manual') {
      const domain = typeof params.domain === 'string' ? params.domain : ''
      const topic = typeof params.topic === 'string' ? params.topic : ''
      const summary = [domain, topic].filter(Boolean).join('/')
      return (
        <CompactToolRow icon={<ToolIcon icon="book-open" className="size-3 shrink-0 text-muted-foreground" />}>
          <span className="font-medium text-foreground">
            {isStreaming ? <>{t('chat.toolBlock.readingManual')}…</> : t('chat.toolBlock.readManual')}
            {summary && <>: <span className="text-muted-foreground">{summary}</span></>}
          </span>
        </CompactToolRow>
      )
    }
    if (mcpInfo.mcpToolName === 'media_list_providers') {
      if (!allowExpand) {
        return (
          <CompactToolRow icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}>
            <span className="font-medium text-foreground">
              {isStreaming ? <>{t('chat.toolBlock.listingMediaProviders')}…</> : t('chat.toolBlock.listedMediaProviders')}
            </span>
          </CompactToolRow>
        )
      }
      return <MediaProvidersBlock result={!isStreaming ? (result ?? null) : null} isStreaming={isStreaming} />
    }
    if (mcpInfo.mcpToolName === 'media_generate_video') {
      if (!allowExpand) {
        const prompt = typeof params.prompt === 'string' ? params.prompt.replace(/\s+/g, ' ').trim() : ''
        return (
          <CompactToolRow icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}>
            <span className="shrink-0 font-medium text-foreground">
              {isStreaming ? <>{t('chat.toolBlock.generatingVideo', 'Generating video')}…</> : t('chat.toolBlock.generatedVideo', 'Video')}
            </span>
            {prompt && <span className="min-w-0 truncate text-muted-foreground">{prompt}</span>}
          </CompactToolRow>
        )
      }
      return <VideoGenToolBlock params={params} result={cleanResult} isStreaming={isStreaming} />
    }
    if (COLLAB_TOOLS.has(mcpInfo.mcpToolName) && !isError && !isDenied) {
      if (!allowExpand) {
        return (
          <CompactToolRow icon={<ToolIcon icon="bot" className="size-3 shrink-0 text-muted-foreground" />}>
            <span className="font-medium text-foreground">{mcpInfo.mcpToolName.replace(/_/g, ' ')}</span>
          </CompactToolRow>
        )
      }
      return (
        <SessionCollabToolBlock
          toolName={mcpInfo.mcpToolName}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'session_tag') {
      const added = Array.isArray(params.add) ? params.add.filter((t): t is string => typeof t === 'string') : []
      const removed = Array.isArray(params.remove) ? params.remove.filter((t): t is string => typeof t === 'string') : []
      const set = Array.isArray(params.set) ? params.set.filter((t): t is string => typeof t === 'string') : []
      const tagBits = added.length
        ? added.join(', ')
        : removed.length
          ? removed.join(', ')
          : set.length
            ? set.join(', ')
            : ''
      const ids = Array.isArray(params.sessionIds) ? params.sessionIds.length : 0
      const summary = [
        tagBits,
        ids > 1 ? `${ids}` : '',
      ].filter(Boolean).join(' · ')
      let label = t('chat.toolBlock.archive.sessionTagged')
      if (isStreaming) label = t('chat.toolBlock.archive.taggingSession')
      else if (isDenied) label = t('chat.toolBlock.archive.sessionTagged')
      else if (isError) label = t('chat.toolBlock.archive.tagFailed')
      return (
        <CompactToolRow icon={<ToolIcon icon="clipboard-list" className="size-3 shrink-0 text-muted-foreground" />}>
          <span className="font-medium text-foreground">
            {label}
            {summary && <>: <span className="text-muted-foreground">{isDenied ? t('chat.toolBlock.denied') : summary}</span></>}
          </span>
        </CompactToolRow>
      )
    }
    if (isSessionArchiveToolName(mcpInfo.mcpToolName)) {
      return (
        <SessionArchiveToolBlock
          toolName={mcpInfo.mcpToolName}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (isAutomationToolName(mcpInfo.mcpToolName)) {
      return (
        <AutomationToolBlock
          toolName={mcpInfo.mcpToolName}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'miniapp_dev_setup') {
      const appName = String(params.name ?? '')
      let parsedResult: Record<string, unknown> | null = null
      if (!isStreaming && result) {
        try { parsedResult = JSON.parse(result) as Record<string, unknown> } catch {}
      }
      return (
        <SetupMiniAppDevBlock
          appName={appName}
          isStreaming={isStreaming}
          params={params}
          result={parsedResult}
        />
      )
    }
    const d = superoneToolDisplay[mcpInfo.mcpToolName]
    if (d) {
      const summaryValue = d.summaryField ? String(params[d.summaryField] ?? '').replace(/\s+/g, ' ').trim() : ''
      return (
        <CompactToolRow icon={<ToolIcon icon={d.icon} className="size-3 shrink-0 text-muted-foreground" />}>
          <span className="shrink-0 whitespace-nowrap font-medium text-foreground">
            {isStreaming ? <>{d.streaming}…</> : d.done}
            {summaryValue ? ':' : ''}
          </span>
          {summaryValue && (
            <span className="min-w-0 truncate text-muted-foreground" title={summaryValue}>
              {summaryValue}
            </span>
          )}
        </CompactToolRow>
      )
    }
    // Fixed miniapp_call (appId+tool in args) or legacy slug__tool transcript names.
    const resolvedAppTool = resolveMiniAppToolIdentity(mcpInfo.mcpToolName, params, miniApps)
    if (resolvedAppTool) {
      const canvasApp = miniApps.find((a) => a.id === resolvedAppTool.appId)
      const toolDef = resolvedAppTool.toolDef
      const mcpToolNamePart = resolvedAppTool.toolName
      const appName = canvasApp?.manifest.name ?? resolvedAppTool.app.manifest.name
      const toolReadableName = toolDef?.displayName ?? mcpToolNamePart.replace(/_/g, ' ')
      const runningText = toolDef?.runningText ?? toolReadableName
      const appToolExpandable = allowExpand && !!(toolDef?.showResult && result && !isStreaming)
      const toolParams = resolvedAppTool.toolInput
      const inputSummary = toolDef?.inputSummaryField ? String(toolParams[toolDef.inputSummaryField] ?? '') : ''
      let resultSummary = ''
      if (!isStreaming && result && toolDef?.resultSummaryField) {
        try { resultSummary = String(JSON.parse(result)[toolDef.resultSummaryField] ?? '') } catch {}
      }

      if (toolInterceptState) {
        return (
          <div className="tool-node my-0.5 rounded bg-muted/20 p-2">
            <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-muted-foreground">
              {canvasApp ? <MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" /> : <ToolIcon icon="plug" className="size-3 shrink-0" />}
              <span>{appName}</span>
              <span className="text-muted-foreground/70">·</span>
              <span>{toolReadableName}</span>
              <span className="text-muted-foreground/70">· needs your input</span>
            </div>
            <ToolRendererFrame phase="intercept" state={toolInterceptState} />
          </div>
        )
      }

      if (toolDef?.standalone && canvasApp) {
        const tplKey = toolDef.renderer?.result?.template
        const tplPath = tplKey ? canvasApp.manifest.templates?.[tplKey] : undefined
        if (tplPath) {
          return (
            <StandaloneToolBlock
              appId={canvasApp.id}
              toolUseId={toolUseId ?? ''}
              toolName={mcpToolNamePart}
              appName={appName}
              toolReadableName={toolReadableName}
              args={toolParams}
              result={result}
              isStreaming={isStreaming}
              templatePath={tplPath}
            />
          )
        }
      }

      const resultRendererCfg = toolDef?.renderer?.result
      const resultTemplatePath = resultRendererCfg && canvasApp?.manifest.templates
        ? canvasApp.manifest.templates[resultRendererCfg.template]
        : undefined
      if (!isStreaming && result && resultRendererCfg && resultTemplatePath && canvasApp) {
        let parsedResult: unknown = null
        try { parsedResult = JSON.parse(result) } catch { parsedResult = result }
        return (
          <AppResultRendererBlock
            appId={canvasApp.id}
            toolUseId={toolUseId ?? ''}
            toolName={mcpToolNamePart}
            appName={grouped ? undefined : appName}
            toolReadableName={toolReadableName}
            summary={resultSummary || inputSummary}
            icon={<MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" />}
            templatePath={resultTemplatePath}
            result={parsedResult}
            autoExpand={!!resultRendererCfg.autoExpand}
          />
        )
      }

      return (
        <AppToolBlock
          icon={canvasApp ? <MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" /> : <ToolIcon icon="plug" className="size-3 shrink-0 text-muted-foreground" />}
          appName={grouped ? undefined : appName}
          toolText={isStreaming ? runningText : toolReadableName}
          summary={isStreaming ? inputSummary : (resultSummary || inputSummary)}
          isStreaming={isStreaming}
          expandable={appToolExpandable}
          result={result}
        />
      )
    }
  }

  if (mcpInfo?.mcpToolName === 'widget_show') {
    const widgetData = (result ? parseWidgetResult(result) : null) ?? parsePartialWidgetInput(input)
    const jsonComplete = isCompleteJson(input)
    const inputComplete = !isStreaming || jsonComplete
    if (isStreaming && jsonComplete && widgetData) {
      window.app.trace?.('widget.ui', 'input_complete_early', { title: widgetData.title, inputLen: input.length })
    }
    // Subagent card: never mount the full widget UI — header-only stub.
    if (!allowExpand) {
      const title = widgetData && typeof (widgetData as { title?: unknown }).title === 'string'
        ? (widgetData as { title: string }).title
        : ''
      return (
        <CompactToolRow icon={<ToolIcon icon="canvas" className="size-3 shrink-0 text-muted-foreground" />}>
          <span className="font-medium text-foreground">
            {isStreaming ? <>{t('chat.toolBlock.generatingWidget')}</> : t('chat.toolBlock.generateWidget')}
          </span>
          {title && <span className="min-w-0 truncate text-muted-foreground">{title}</span>}
        </CompactToolRow>
      )
    }
    if (widgetData) return <WidgetBlock data={widgetData} streaming={!inputComplete} />
    return (
      <CompactToolRow icon={<ToolIcon icon="canvas" className="size-3 shrink-0 text-muted-foreground" />}>
        <span className="font-medium text-foreground">
          {isStreaming ? <>{t('chat.toolBlock.generatingWidget')}</> : t('chat.toolBlock.generateWidget')}
        </span>
      </CompactToolRow>
    )
  }

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
        ) : isMcp && mcpIconSrc ? (
          <img src={mcpIconSrc} alt={mcpInfo.serverName} className="size-3.5 shrink-0 rounded-sm object-cover" />
        ) : (
          <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('shrink-0 whitespace-nowrap font-medium', isDenied && toolName !== 'AskUserQuestion' ? 'text-error' : isError ? 'text-warning' : 'text-foreground')}>
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName === 'AskUserQuestion' ? `Asked${display.summary ? ` ${display.summary}` : ''}` : displayName}
        </span>
        {isQuestionDismissed ? (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground">{t('chat.toolBlock.dismissed')}</span>
        ) : isDenied ? (
          <>
            {fileToolName ? (
              <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
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
              <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            ) : summary ? (
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
            ) : null}
            <span className="shrink-0 rounded bg-warning/20 px-1 py-px text-xs text-warning">{t('chat.toolBlock.error')}</span>
          </>
        ) : fileToolName ? (
          <>
            <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            {toolName === 'Read' && formatReadMeta(params) && (
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">{formatReadMeta(params)}</span>
            )}
          </>
        ) : summary ? (
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        ) : null}
        {lineDelta && (lineDelta.added > 0 || lineDelta.removed > 0) && (
          <span className="shrink-0 font-mono text-xs">
            {lineDelta.added > 0 && (
              <span className="inline-flex items-baseline text-success">
                +<RollingNumber value={lineDelta.added} />
              </span>
            )}
            {lineDelta.added > 0 && lineDelta.removed > 0 && <span className="text-muted-foreground/50"> </span>}
            {lineDelta.removed > 0 && (
              <span className="inline-flex items-baseline text-error">
                -<RollingNumber value={lineDelta.removed} />
              </span>
            )}
          </span>
        )}
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className={cn('ml-auto shrink-0 transition-colors duration-500', getStallColor(stallLevel))}>{Math.round(elapsedSeconds)}s</span>
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
                  {toolName === 'Edit' && (isStreaming
                    ? <CanvasEditDiff params={params} />
                    : (String(params.old_string ?? '') || String(params.new_string ?? '')
                      ? <EditDiff params={params} />
                      : <FileChangeDiff params={params} />)
                  )}
                  {toolName === 'Write' && <WriteDiff params={params} isStreaming={isStreaming} />}
                  {toolName === 'FileChange' && <FileChangeDiff params={params} isStreaming={isStreaming} />}
                  {isError && cleanResult && (
                    <div className="text-xs text-warning/90">{extractToolError(cleanResult)}</div>
                  )}
                  {hasResult && !isError && (!hasDiff || toolName === 'FileChange') && (
                    <div onClick={(e) => e.stopPropagation()}>
                      {isMcp ? (
                        <PrettyJSONCodeBlock text={cleanResult!} />
                      ) : toolName === 'LS' || toolName === 'ToolSearch' || toolName === 'SearchTools' ? (
                        <ScrollableToolResult text={cleanResult!} />
                      ) : (
                        <ToolResult text={cleanResult!} />
                      )}
                    </div>
                  )}
                  {hasQA && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <AskUserQuestionResult text={cleanResult!} params={params} />
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
})

export function FileChip({ name, title, filePath, lineNumber, className }: { name: string; title: string; filePath?: string; lineNumber?: number; className?: string }) {
  const parsed = filePath ? parseFileLinkTarget(filePath) : null
  const targetPath = parsed?.filePath
  const targetLineNumber = lineNumber ?? parsed?.lineNumber
  const dragEndRef = useRef(0)

  const handleClick = (e: React.MouseEvent): void => {
    if (Date.now() - dragEndRef.current < 200) return
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    if (!targetPath) return
    const projectPath = useChatStore.getState().activeProject
    if (!projectPath) return
    const relative = targetPath.startsWith(projectPath + '/') ? targetPath.slice(projectPath.length + 1) : targetPath
    useSourceControlStore.getState().selectFile(projectPath, relative, targetLineNumber)
    openFileTab(relative)
  }
  return (
    <span
      role="button"
      onClick={handleClick}
      title={title}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground hover:bg-muted/80 transition-colors"
    >
      <DraggableFileIcon name={name} filePath={targetPath} dragEndRef={dragEndRef} className="shrink-0" />
      <span className={cn('truncate', className)}>{name}</span>
      {targetLineNumber != null && <span className="text-muted-foreground text-xs">#L{targetLineNumber}</span>}
    </span>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

interface MobileShareResult {
  ok?: boolean
  name?: string
  size?: number
  mimeType?: string
  deviceName?: string
  sentAt?: number
  path?: string
  transport?: 'inline' | 'relay'
  expiresAt?: number
}

function MobileShareFileBlock({ params, result, isStreaming }: {
  params: Record<string, unknown>
  result: string | null
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const path = String(params.path ?? '')
  const fileName = path.split('/').pop() || path
  const progress = useShareProgress(path)

  let parsed: MobileShareResult | null = null
  if (!isStreaming && result) {
    try { parsed = JSON.parse(result) as MobileShareResult } catch { /* not JSON */ }
  }
  const done = !!parsed?.ok
  const failed = !isStreaming && !done
  const errorText = failed ? (result ?? '').replace(/^\[Error\]\s*/, '').trim() : ''

  const fileChip = <FileChip name={fileName} title={path} filePath={path} className="max-w-45" />

  const header = (
    <div
      className={cn('flex items-center gap-1.5 px-2 py-1.5 text-xs', done && 'cursor-pointer')}
      onClick={done ? () => setExpanded((e) => !e) : undefined}
    >
      {done
        ? <Smartphone className="size-3 shrink-0 text-muted-foreground" />
        : failed
          ? <Ban className="size-3 shrink-0 text-destructive" />
          : <Upload className="size-3 shrink-0 text-primary" />}
      <span className={cn('shrink-0', failed ? 'text-destructive' : 'text-foreground')}>{done ? 'Sent' : failed ? 'Failed to send' : 'Sending'}</span>
      {fileChip}
      {done && parsed?.deviceName && (
        <>
          <span className="shrink-0 text-muted-foreground">to</span>
          <span className="min-w-0 truncate text-foreground">{parsed.deviceName}</span>
        </>
      )}
      {failed && errorText && (
        <span className="min-w-0 truncate text-muted-foreground">{errorText}</span>
      )}
      {!done && !failed && progress && (
        <span className="ml-auto shrink-0 tabular-nums text-primary">
          {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
        </span>
      )}
      {done && (
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      )}
    </div>
  )

  if (!done) {
    return <div className="tool-node my-0.5 rounded bg-muted/20">{header}</div>
  }

  const sentAt = parsed?.sentAt ? new Date(parsed.sentAt) : null
  const rows: Array<{ label: string; value: React.ReactNode }> = []
  if (sentAt) rows.push({ label: 'Sent at', value: <span className="tabular-nums">{sentAt.toLocaleString()}</span> })
  rows.push({ label: 'Path', value: <span className="font-mono text-xs text-primary break-all">{parsed?.path ?? path}</span> })
  if (parsed?.size != null) rows.push({ label: 'Size', value: `${formatBytes(parsed.size)}${parsed.mimeType ? ` · ${parsed.mimeType}` : ''}` })
  rows.push({
    label: 'Delivery',
    value: parsed?.transport === 'relay'
      ? <span className="text-muted-foreground">Encrypted link{parsed.expiresAt ? ` · expires ${new Date(parsed.expiresAt).toLocaleTimeString()}` : ''}</span>
      : <span className="text-muted-foreground">Delivered inline · encrypted</span>,
  })

  return (
    <div className="tool-node my-0.5 rounded bg-muted/20">
      {header}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className="border-t border-border/60 px-2 py-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {rows.map((r) => (
                <div key={r.label} className="contents">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="min-w-0 text-foreground">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BASH_LOAD_CHUNK = 50

function BashTerminalView({
  toolUseId,
  command,
  description,
  fallbackResult,
  isStreaming,
  isDenied,
  isError,
  timeoutMs,
  isTimedOut,
  resultOutputPath,
  runInBackground,
  autoExpand,
  allowExpand = true,
  backgroundActivity,
  trailingAction,
}: {
  toolUseId: string
  command: string
  description?: string
  fallbackResult?: string
  isStreaming: boolean
  isDenied?: boolean
  isError?: boolean
  timeoutMs?: number
  isTimedOut?: boolean
  resultOutputPath?: string
  runInBackground?: boolean
  autoExpand?: boolean
  /** When false, header-only (subagent card); full view leaves default true. */
  allowExpand?: boolean
  backgroundActivity?: boolean
  trailingAction?: ReactNode
}) {
  const bashOutput = useBashOutput(toolUseId)
  const { t } = useTranslation()
  const outputExpired = !!resultOutputPath && !bashOutput && !isStreaming
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isLiveRunning = !!bashOutput && !bashOutput.finished
  const taskProgress = useActiveSession((s) => s.taskProgress[toolUseId])
  const isPendingPermission = useActiveSession((s) => s.pendingPermissions.some((p) => p.toolUseId === toolUseId))
  const hasResult = !!fallbackResult || isDenied
  const isRunning = (isStreaming && !hasResult && !isPendingPermission) || isLiveRunning
  const hasTaskState = !!taskProgress
  const bgFailed = taskProgress?.status === 'failed'
  const bgStopped = !!taskProgress?.status && taskProgress.status !== 'completed' && !bgFailed
  const showError = (isError || bgFailed) && !isDenied
  const treatAsBackground = backgroundActivity || runInBackground
  const holdOpenForBackgroundTask = treatAsBackground
    ? (hasTaskState ? taskProgress.completed !== true : isRunning)
    : false
  const autoExpanded = allowExpand && holdOpenForBackgroundTask
  const [expanded, setExpanded] = useState(allowExpand && autoExpand ? autoExpanded : false)
  const [outputFull, setOutputFull] = useState(false)
  const [extraContent, setExtraContent] = useState('')
  const [loadedLines, setLoadedLines] = useState(BASH_LOAD_CHUNK)
  const [hasMore, setHasMore] = useState(true)
  const loadingRef = useRef(false)
  const prevExtraRef = useRef('')
  const prevScrollHeightRef = useRef(0)
  const [restoredContent, setRestoredContent] = useState<string | null>(outputExpired ? null : '')
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!allowExpand) {
      setExpanded(false)
      return
    }
    if (autoExpand) setExpanded(autoExpanded)
    else setExpanded(false)
  }, [allowExpand, autoExpand, autoExpanded])

  useEffect(() => {
    if (!expanded) setOutputFull(false)
  }, [expanded])

  useEffect(() => {
    if (!outputExpired || !resultOutputPath || restoredRef.current) return
    restoredRef.current = true
    window.app.readBashOutputFile(resultOutputPath, 50).then((result) => {
      setRestoredContent(result || '')
    })
  }, [outputExpired, resultOutputPath])

  const liveContent = outputExpired
    ? (restoredContent || '')
    : (bashOutput?.content || fallbackResult || '')
  const liveContentRef = useRef(liveContent)
  liveContentRef.current = liveContent
  const outputPath = bashOutput?.outputPath || (restoredContent ? resultOutputPath : undefined)
  const isLive = isLiveRunning
  const timerActive = isRunning
  const content = extraContent ? extraContent + '\n' + liveContent : liveContent
  const fileExpired = outputExpired && restoredContent === ''

  const [localElapsed, setLocalElapsed] = useState(0)
  const startTimeRef = useRef(0)
  useEffect(() => {
    if (!timerActive) {
      startTimeRef.current = 0
      setLocalElapsed(0)
      return
    }
    if (!startTimeRef.current) startTimeRef.current = Date.now()
    const tick = (): void => setLocalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerActive])

  useEffect(() => {
    if (isLive && !outputFull && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveContent, isLive, outputFull])

  useLayoutEffect(() => {
    if (extraContent && extraContent !== prevExtraRef.current) {
      const el = scrollRef.current
      if (el && !outputFull) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      prevExtraRef.current = extraContent
    }
  }, [extraContent, outputFull])

  const loadMore = useCallback(async () => {
    if (!outputPath || isLive || loadingRef.current || !hasMore) return
    loadingRef.current = true
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0
    const nextLines = loadedLines + BASH_LOAD_CHUNK
    const result = outputExpired
      ? await window.app.readBashOutputFile(outputPath, nextLines)
      : await window.app.readBashOutputMore(toolUseId, nextLines)
    const resultLineCount = result.split('\n').length
    if (resultLineCount <= loadedLines) {
      setHasMore(false)
    } else {
      const lc = liveContentRef.current
      const tail = result.split('\n').slice(0, -lc.split('\n').length)
      setExtraContent(tail.join('\n'))
      setLoadedLines(nextLines)
    }
    loadingRef.current = false
  }, [toolUseId, outputPath, outputExpired, isLive, hasMore, loadedLines])

  useEffect(() => {
    if (isLive || !expanded || !hasMore || !outputPath) return
    const el = scrollRef.current
    const sentinel = sentinelRef.current
    if (!el || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { root: outputFull ? null : el, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isLive, expanded, hasMore, outputPath, loadMore, outputFull])

  return (
    <div className={cn(
      'tool-node my-0.5 rounded transition-colors',
      allowExpand && 'cursor-pointer',
      isDenied
        ? `denied bg-error/10${allowExpand ? ' hover:bg-error/20' : ''}`
        : showError
          ? `errored bg-warning/10${allowExpand ? ' hover:bg-warning/20' : ''}`
          : `bg-muted/20${allowExpand ? ' hover:bg-muted/40' : ''}`,
      expanded && 'overflow-hidden',
    )}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={allowExpand ? () => setExpanded((e) => !e) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : showError ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <ToolIcon icon="terminal" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('font-medium', isDenied ? 'text-error' : showError ? 'text-warning' : 'text-foreground', isRunning && !isDenied && 'animate-shimmer')}>
          {isRunning && !isDenied ? t('chat.toolBlock.running') : 'Bash'}
        </span>
        {isRunning && localElapsed >= 1 && <span className="text-muted-foreground tabular-nums">{localElapsed}s</span>}
        {description
          ? <span className="min-w-0 truncate text-muted-foreground">{description}</span>
          : (!expanded || fileExpired) && <span className="min-w-0 truncate text-muted-foreground">{command}</span>
        }
        {timeoutMs && <span className="rounded bg-muted px-1 py-px text-xs text-muted-foreground">{Math.round(timeoutMs / 1000)}s</span>}
        {isDenied && <span className="rounded bg-error/20 px-1 py-px text-xs text-error">Denied</span>}
        {showError && <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">{t('chat.toolBlock.error')}</span>}
        {bgStopped && !showError && <span className="rounded bg-muted px-1 py-px text-xs text-muted-foreground">{t('chat.subagent.stopped')}</span>}
        {isTimedOut && <span className="rounded bg-error/20 px-1 py-px text-xs text-error">{t('chat.toolBlock.timedOut')}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {trailingAction}
          {allowExpand && (
            <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
          )}
        </div>
      </div>
      {allowExpand && expanded && (fileExpired ? (
        <div className="px-3 py-1.5 text-xs text-muted-foreground/50 italic">
          {t('chat.toolBlock.outputFileExpired', { path: resultOutputPath!.split('/').pop() })}
        </div>
      ) : (
        <TerminalCommandOutput
          command={command}
          hasOutput={!!content}
          outputRef={scrollRef}
          outputVersion={content}
          outputFull={outputFull}
          onOutputFullChange={setOutputFull}
          outputPrefix={!isLive && hasMore && outputPath ? <div ref={sentinelRef} className="h-px" /> : undefined}
        >
          {outputExpired && restoredContent === null ? (
            <div className="animate-shimmer text-terminal-dim">{t('common.loading')}</div>
          ) : content ? (
            <div className={showError ? 'text-amber-300' : 'text-terminal-muted'}><AnsiText text={showError ? extractToolError(content) : content} /></div>
          ) : isStreaming ? (
            <div className="text-terminal-muted">
              <span className="animate-shimmer">{t('chat.toolBlock.runningInline')}</span>{localElapsed >= 1 && <span className="text-terminal-dim"> {localElapsed}s{timeoutMs && !isLive ? ` · timeout ${Math.round(timeoutMs / 1000)}s` : ''}</span>}
            </div>
          ) : null}
        </TerminalCommandOutput>
      ))}
    </div>
  )
}

const RESULT_PREVIEW_LINES = 10
const SCROLLABLE_RESULT_MAX_H = 'max-h-60'

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

function buildDiffSourceLines(lines: DiffLine[]): { oldLines: string[]; newLines: string[] } {
  const oldLines: string[] = []
  const newLines: string[] = []

  for (const line of lines) {
    if (line.kind !== 'added') oldLines.push(line.text)
    if (line.kind !== 'removed') newLines.push(line.text)
  }

  return {
    oldLines,
    newLines,
  }
}


const TOOL_DIFF_CLASS = 'bg-transparent'

/** Unified diff for Edit tool with actual file line numbers. */
export function EditDiff({ params }: { params: Record<string, unknown> }) {
  const oldStr = String(params.old_string ?? '')
  const newStr = String(params.new_string ?? '')
  const filePath = String(params.file_path ?? '')
  const activeProject = useChatStore((s) => s.activeProject)
  const [startLine, setStartLine] = useState(1)
  const language = inferLanguage(filePath)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])

  const oldTokens = useHighlightedTokens(oldStr, language, { cache })
  const newTokens = useHighlightedTokens(newStr, language, { cache })

  useEffect(() => {
    if (!filePath || !activeProject) return
    let cancelled = false
    const tryFind = async (): Promise<void> => {
      if (newStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, newStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
      if (oldStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, oldStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
    }
    tryFind()
    return () => { cancelled = true }
  }, [filePath, oldStr, newStr, activeProject])

  const lines = useMemo<DiffLine[]>(
    () => buildDiffLines(oldStr, newStr, startLine),
    [oldStr, newStr, startLine],
  )

  if (!oldStr && !newStr) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} className={TOOL_DIFF_CLASS} />
}

/** Content preview for Write tool (all lines are additions). */
export function WriteDiff({ params, isStreaming }: { params: Record<string, unknown>; isStreaming?: boolean }) {
  return isStreaming
    ? <WriteDiffStreaming params={params} />
    : <WriteDiffStatic params={params} />
}

function WriteDiffStreaming({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const contentLines = useMemo(() => content ? content.split('\n') : [], [content])
  const committedLines = useMemo(() => {
    if (!content) return []
    const idx = content.lastIndexOf('\n')
    if (idx === -1) return []
    return content.slice(0, idx).split('\n')
  }, [content])
  const tokens = useIncrementalHighlightedLines(committedLines, language)
  const lines = useMemo<DiffLine[]>(() => {
    if (contentLines.length === 0) return []
    return contentLines.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }, [contentLines])
  if (lines.length === 0) return null
  return <DiffView lines={lines} newTokens={tokens} autoScrollBottom className={TOOL_DIFF_CLASS} />
}

function WriteDiffStatic({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const activeProject = useChatStore((s) => s.activeProject)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])
  const contentLines = useMemo(() => content ? content.split('\n') : [], [content])
  const tokens = useHighlightedTokens(content, language, { cache })
  const lines = useMemo<DiffLine[]>(() => {
    if (contentLines.length === 0) return []
    return contentLines.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }, [contentLines])
  if (lines.length === 0) return null
  return <DiffView lines={lines} newTokens={tokens} className={TOOL_DIFF_CLASS} />
}

function FileChangeDiff({ params, isStreaming }: { params: Record<string, unknown>; isStreaming?: boolean }) {
  return isStreaming
    ? <FileChangeDiffStreaming params={params} />
    : <FileChangeDiffStatic params={params} />
}

function FileChangeDiffStreaming({ params }: { params: Record<string, unknown> }) {
  const diff = String(params.diff ?? '')
  const kind = String(params.kind ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildFileChangeDiffLines(kind, diff), [kind, diff])
  const { oldLines, newLines } = useMemo(() => buildDiffSourceLines(lines), [lines])
  const hasPartialTail = diff.length > 0 && !diff.endsWith('\n')
  const committedOldLines = useMemo(
    () => (hasPartialTail && oldLines.length > 0 ? oldLines.slice(0, -1) : oldLines),
    [oldLines, hasPartialTail],
  )
  const committedNewLines = useMemo(
    () => (hasPartialTail && newLines.length > 0 ? newLines.slice(0, -1) : newLines),
    [newLines, hasPartialTail],
  )
  const oldTokens = useIncrementalHighlightedLines(committedOldLines, language)
  const newTokens = useIncrementalHighlightedLines(committedNewLines, language)
  if (!diff || lines.length === 0) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} autoScrollBottom className={TOOL_DIFF_CLASS} />
}

function FileChangeDiffStatic({ params }: { params: Record<string, unknown> }) {
  const diff = String(params.diff ?? '')
  const kind = String(params.kind ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const activeProject = useChatStore((s) => s.activeProject)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])
  const lines = useMemo(() => buildFileChangeDiffLines(kind, diff), [kind, diff])
  const { oldLines, newLines } = useMemo(() => buildDiffSourceLines(lines), [lines])
  const oldTokens = useHighlightedTokens(oldLines.join('\n'), language, { cache })
  const newTokens = useHighlightedTokens(newLines.join('\n'), language, { cache })
  if (!diff || lines.length === 0) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} className={TOOL_DIFF_CLASS} />
}

/** ExitPlanMode: shows pending / approved / rejected state.
 *  Derives outcome from tool result (persisted in messages) with live store as fallback. */
function ExitPlanModeBlock({ result }: { result?: string }) {
  const liveOutcome = useActiveSession((s) => s.planApprovalOutcome)

  const isDenied = !!result && result.startsWith('[denied] ')
  const resultOutcome = result
    ? (isDenied ? { approved: false, feedback: result.slice('[denied] '.length) } : { approved: true })
    : null
  const outcome = resultOutcome ?? liveOutcome

  if (!outcome) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-muted/20 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Review Plan</span>
      </div>
    )
  }

  if (outcome.approved) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-success/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-success" />
        <span className="font-medium text-success">Plan Approved</span>
        <Check className="ml-auto size-3 shrink-0 text-success" />
      </div>
    )
  }

  return (
    <div className="my-4 rounded bg-error/10 px-2 py-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <PenLine className="size-3 shrink-0 text-error" />
        <span className="font-medium text-error">Plan Rejected</span>
        <X className="ml-auto size-3 shrink-0 text-error" />
      </div>
      {outcome.feedback && outcome.feedback !== 'User rejected the plan' && (
        <div className="mt-1 text-xs text-error/70">{outcome.feedback}</div>
      )}
    </div>
  )
}

/** Debug view showing raw input and output for a tool call. */
export function DebugToolBlock({
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
    <div className="my-0.5 rounded border border-amber-500/30 bg-muted/20">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        <span className="size-3 shrink-0 text-center text-warning">&#9881;</span>
        <span className="font-medium text-warning">
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName}
        </span>
        <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">debug</span>
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
        )}
      </div>
      <div className="px-2 pb-1.5 space-y-1.5">
        <div>
          <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">Input</div>
          <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all">
            {prettyInput || <span className="text-muted-foreground italic">empty</span>}
          </div>
        </div>
        {result && !isStreaming && (
          <div>
            <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">Output</div>
            <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
