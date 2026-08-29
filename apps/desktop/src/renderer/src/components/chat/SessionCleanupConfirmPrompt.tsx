/**
 * HITL prompt for permanent session_cleanup delete — lists target sessions
 * with the same visual grammar as session_list (harness icon, title, msg count, date).
 * Decision row reuses PermissionPrompt's ApproveRejectBar (allow / deny + optional feedback).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Folder, MessageSquare, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  PermissionRequest,
  SessionCleanupConfirmPayload,
  SessionCleanupConfirmSession,
} from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { resolveProjectNameFromFolders, resolveProjectPathForOpen } from '@/lib/resolve-project-path'
import { useAppStore } from '@/stores/app'
import { useChatStore, useScopedSessionActions } from '@/stores/chat'
import { ApproveRejectBar } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

/** Mosaic-aware open; resolve projectId → path in the host (not in agent payloads). */
function openSessionFromConfirm(sessionId: string, projectId?: string | null) {
  if (!sessionId) return
  void (async () => {
    const target = await resolveProjectPathForOpen(projectId, useChatStore.getState().activeProject)
    if (!target) return
    if (useMosaicStore.getState().focusOrReplaceFocused(target, sessionId)) return
    await useChatStore.getState().switchToSession(target, sessionId)
  })()
}

interface ProjectGroup {
  projectId: string | null
  sessions: SessionCleanupConfirmSession[]
}

/**
 * session_cleanup ids may span projects, so the confirm list must say which project
 * each session belongs to — a bare title gives the user no way to tell a foreign
 * repo's session from their own before approving a permanent delete.
 * Grouping keeps first-appearance order so the list still mirrors the agent's request.
 */
function groupByProject(sessions: SessionCleanupConfirmSession[]): ProjectGroup[] {
  const groups: ProjectGroup[] = []
  const byId = new Map<string, ProjectGroup>()
  for (const s of sessions) {
    const key = s.projectId ?? ''
    let group = byId.get(key)
    if (!group) {
      group = { projectId: s.projectId ?? null, sessions: [] }
      byId.set(key, group)
      groups.push(group)
    }
    group.sessions.push(s)
  }
  return groups
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
            openSessionFromConfirm(s.id, s.projectId)
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
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{created}</span>
      ) : null}
    </div>
  )
}

function ProjectGroupHeader({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation()
  const recentFolders = useAppStore((s) => s.recentFolders)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const name = resolveProjectNameFromFolders(projectId, recentFolders)
  const isCurrent = !!projectId && projectId === currentProjectId
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-1 pb-0.5 pt-1 first:pt-0">
      <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={projectId ?? undefined}>
        {name ?? t('chat.permission.sessionCleanupUnknownProject')}
      </span>
      {isCurrent ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          · {t('chat.toolBlock.archive.thisProject')}
        </span>
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
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const groups = useMemo(() => groupByProject(sessions), [sessions])
  // Headers exist to expose foreign projects: skip them only for the plain
  // everything-is-the-current-project case, where they would be pure noise.
  const showGroupHeaders = groups.length > 1
    || (groups.length === 1 && !!groups[0]!.projectId && groups[0]!.projectId !== currentProjectId)
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
            groups.map((group) => (
              <div key={group.projectId ?? ''} className="space-y-0.5">
                {showGroupHeaders ? <ProjectGroupHeader projectId={group.projectId} /> : null}
                {group.sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    openLabel={t('chat.toolBlock.archive.openSession')}
                  />
                ))}
              </div>
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
  const { respondToPermission } = useScopedSessionActions()
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
