/**
 * HITL prompt for permanent session_cleanup delete — lists target sessions
 * with the same visual grammar as session_list (harness icon, title, msg count, date).
 * Decision row reuses PermissionPrompt's ApproveRejectBar (allow / deny + optional feedback).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  PermissionRequest,
  SessionCleanupConfirmPayload,
  SessionCleanupConfirmSession,
} from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useChatStore } from '@/stores/chat'
import { ApproveRejectBar } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

/** Same path as SessionArchiveToolBlock / sidebar — mosaic-aware same-project open. */
function openSessionFromConfirm(sessionId: string) {
  if (!sessionId) return
  const projectPath = useChatStore.getState().activeProject
  if (!projectPath) return
  if (useMosaicStore.getState().focusOrReplaceFocused(projectPath, sessionId)) return
  void useChatStore.getState().switchSession(sessionId)
}

function formatCreatedAt(iso: string | undefined, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (y === now.getFullYear()) {
    return `${md} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${y}-${md}`
}

function HarnessGlyph({
  harness,
  acpAgentId,
}: {
  harness?: string
  acpAgentId?: string | null
}) {
  const Icon = resolveSessionIcon(harness || null, acpAgentId)
  if (!Icon) {
    return <MessageSquare className="size-3 shrink-0 text-muted-foreground" aria-hidden />
  }
  return (
    <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground" title={harness}>
      <Icon status="default" size={12} renderLevel="compact" />
    </span>
  )
}

function SessionRow({ s, openLabel }: { s: SessionCleanupConfirmSession; openLabel: string }) {
  const { t } = useTranslation()
  const created = formatCreatedAt(s.createdAt)
  return (
    <div className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5" title={s.id}>
      <HarnessGlyph harness={s.harness} acpAgentId={s.acpAgentId} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openSessionFromConfirm(s.id)
          }}
          className="min-w-0 cursor-pointer truncate text-left text-xs font-medium text-foreground hover:underline"
          title={openLabel || t('chat.toolBlock.archive.openSession')}
        >
          {s.title}
        </button>
        {typeof s.messageCount === 'number' ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums text-muted-foreground">
            <MessageSquare className="size-3 opacity-70" aria-hidden />
            {s.messageCount}
          </span>
        ) : null}
      </span>
      {created ? (
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{created}</span>
      ) : null}
    </div>
  )
}

export function SessionCleanupConfirmPrompt({
  payload,
  onConfirm,
  onReject,
}: {
  payload: SessionCleanupConfirmPayload
  onConfirm: () => void
  /** Optional deny reason (same channel as tool permission feedback). */
  onReject: (feedback?: string) => void
}) {
  const { t } = useTranslation()
  const sessions = payload.sessions ?? []
  const count = sessions.length
  const chatRootRef = useChatRootRef()
  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!canAutofocusInChatRoot(chatRootRef?.current)) return
      approveRef.current?.focus()
    })
  }, [chatRootRef, count])

  // Same Enter / Esc grammar as PermissionPrompt + SessionAgentsConfirmPrompt
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isFocusInChat(chatRootRef?.current)) return
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (feedbackFocused) {
          onReject(feedback.trim() || undefined)
        } else {
          onConfirm()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onReject(feedback.trim() || undefined)
        return
      }
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !feedbackFocused) {
        e.preventDefault()
        feedbackRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chatRootRef, feedback, feedbackFocused, onConfirm, onReject])

  return (
    <div className="mx-3 mb-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs">
          <Trash2 className="size-3.5 shrink-0 text-destructive" />
          <span className="font-medium text-foreground">
            {t('chat.permission.sessionCleanupTitle', { count })}
          </span>
        </div>
        <div
          className={cn(
            'mb-3 max-h-48 space-y-0.5 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5',
          )}
        >
          {sessions.length === 0 ? (
            <div className="px-1 py-1 text-xs text-muted-foreground">
              {t('chat.permission.sessionCleanupEmpty')}
            </div>
          ) : (
            sessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                openLabel={t('chat.toolBlock.archive.openSession')}
              />
            ))
          )}
        </div>
        <ApproveRejectBar
          approveRef={approveRef}
          rejectRef={rejectRef}
          feedbackRef={feedbackRef}
          onApprove={onConfirm}
          onReject={() => onReject(feedback.trim() || undefined)}
          // Same labels as the standard permission prompt
          approveLabel={t('chat.permission.allow')}
          rejectLabel={t('chat.permission.deny')}
          feedback={{
            value: feedback,
            onChange: setFeedback,
            focused: feedbackFocused,
            onFocusChange: setFeedbackFocused,
          }}
        />
      </div>
    </div>
  )
}

export function SessionCleanupConfirmPromptContainer({
  request,
}: {
  request: PermissionRequest
}) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const payload = request.sessionCleanupConfirm
  if (!payload) return null

  const handleConfirm = useCallback(() => {
    void respondToPermission(request.requestId, true)
  }, [request.requestId, respondToPermission])

  const handleReject = useCallback((feedback?: string) => {
    void respondToPermission(request.requestId, false, undefined, feedback)
  }, [request.requestId, respondToPermission])

  return (
    <SessionCleanupConfirmPrompt
      payload={payload}
      onConfirm={handleConfirm}
      onReject={handleReject}
    />
  )
}
