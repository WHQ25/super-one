/**
 * HITL prompt for agent_profile_apply / agent_profile_delete.
 *
 * Create shows the whole profile, update shows only the fields that change as
 * before → after, delete lists the agents in the destructive style. Fields the
 * harness or model cannot carry are explicit "Not supported" rows, driven by
 * the payload rather than by harness branches here.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react'
import type {
  AgentProfileConfirmChange,
  AgentProfileConfirmPayload,
  AgentProfileConfirmView,
  AgentProfileRuntimeField,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { acpAgentDisplayName } from '@superone/shared/acp-brand'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { cn } from '@superone/ui/lib/utils'
import { useScopedSessionActions } from '@/stores/chat'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { ExpandablePrompt } from './AutomationConfirmPrompt'
import { ApproveRejectBar } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { shouldSuppressDecisionShortcut, wasChatInputFocusedRecently } from './composer-slot/decision-composer-policy'

const P = 'chat.permission.agentProfile'

function harnessLabel(view: Pick<AgentProfileConfirmView, 'harnessId' | 'acpAgentId'>): string {
  const harness = HARNESS_CAPABILITIES[view.harnessId]?.displayName ?? view.harnessId
  return view.acpAgentId ? `${harness} · ${acpAgentDisplayName(view.acpAgentId)}` : harness
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs leading-snug">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 break-words text-foreground">{children}</div>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

/** One runtime field: its value, the user default when unset, or "Not supported". */
function RuntimeRow({
  view,
  field,
  value,
}: {
  view: AgentProfileConfirmView
  field: 'model' | AgentProfileRuntimeField
  value: string | undefined
}) {
  const { t } = useTranslation()
  const unsupported = field !== 'model' && view.unsupported?.includes(field)
  return (
    <FieldRow label={t(`${P}.fields.${field}`)}>
      {unsupported ? <Muted>{t(`${P}.unsupported`)}</Muted> : value ? value : <Muted>{t(`${P}.userDefault`)}</Muted>}
    </FieldRow>
  )
}

function ProfileBody({ view }: { view: AgentProfileConfirmView }) {
  const { t } = useTranslation()
  const model = view.model ? (view.modelName ?? view.model) : undefined
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Bot className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{view.name}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90">{view.description}</p>
      <RuntimeRow view={view} field="model" value={model} />
      <RuntimeRow view={view} field="effort" value={view.effort ? formatEffortLabel(view.effort) : undefined} />
      <RuntimeRow view={view} field="fastMode" value={view.fastMode === undefined ? undefined : t(`${P}.${view.fastMode ? 'on' : 'off'}`)} />
      <RuntimeRow view={view} field="context" value={view.context === '1m' ? '1M' : undefined} />
      <FieldRow label={t(`${P}.fields.instructions`)}>
        {view.instructions ? (
          <ExpandablePrompt
            prompt={view.instructions}
            expandTitle={t('chat.collaboration.expandTask')}
            collapseTitle={t('chat.collaboration.collapseTask')}
          />
        ) : (
          <Muted>{t(`${P}.none`)}</Muted>
        )}
      </FieldRow>
    </div>
  )
}

function changeText(change: AgentProfileConfirmChange, side: 'from' | 'to', t: (key: string) => string): string | undefined {
  const raw = change[side]
  if (!raw) return undefined
  if (change.field === 'effort') return formatEffortLabel(raw)
  if (change.field === 'fastMode') return t(`${P}.${raw === 'on' ? 'on' : 'off'}`)
  if (change.field === 'context') return raw === '1m' ? '1M' : raw
  return raw
}

function ChangeRow({ change }: { change: AgentProfileConfirmChange }) {
  const { t } = useTranslation()
  const from = changeText(change, 'from', t)
  const to = changeText(change, 'to', t)
  const unset = change.field === 'instructions' || change.field === 'description' ? t(`${P}.none`) : t(`${P}.userDefault`)
  // Long text compares as two stacked blocks; short values read on one line.
  if (change.field === 'instructions' || change.field === 'description') {
    return (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{t(`${P}.fields.${change.field}`)}</div>
        {(['before', 'after'] as const).map((side) => {
          const text = side === 'before' ? from : to
          return (
            <div key={side} className="flex items-start gap-2 text-xs">
              <span className={cn('w-14 shrink-0', side === 'before' ? 'text-muted-foreground' : 'text-foreground')}>{t(`${P}.${side}`)}</span>
              <div className={cn('min-w-0 flex-1', side === 'before' && 'opacity-70')}>
                {text ? <ExpandablePrompt prompt={text} expandTitle={t('chat.collaboration.expandTask')} collapseTitle={t('chat.collaboration.collapseTask')} /> : <Muted>{unset}</Muted>}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <FieldRow label={t(`${P}.fields.${change.field}`)}>
      <span className="text-muted-foreground line-through decoration-muted-foreground/60">{from ?? unset}</span>
      <span className="mx-1 text-muted-foreground">→</span>
      <span>{to ?? unset}</span>
    </FieldRow>
  )
}

export function AgentProfileConfirmPrompt({
  payload,
  onConfirm,
  onReject,
}: {
  payload: AgentProfileConfirmPayload
  onConfirm: () => void
  onReject: (feedback?: string) => void
}) {
  const { t } = useTranslation()
  const chatRootRef = useChatRootRef()
  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)
  const { operation, profiles } = payload
  const subject = profiles[0]

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!canAutofocusInChatRoot(chatRootRef?.current) || wasChatInputFocusedRecently(chatRootRef?.current)) return
      approveRef.current?.focus()
    })
  }, [chatRootRef, operation, profiles.length])

  const reject = useCallback(() => onReject(feedback.trim() || undefined), [feedback, onReject])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (shouldSuppressDecisionShortcut(e, chatRootRef?.current)) return
      if (hasOpenRadixOverlay()) return
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (feedbackFocused) reject()
        else onConfirm()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        reject()
        return
      }
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !feedbackFocused) {
        e.preventDefault()
        feedbackRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chatRootRef, feedbackFocused, onConfirm, reject])

  const Icon = operation === 'delete' ? Trash2 : operation === 'update' ? Pencil : Plus
  const title = operation === 'delete'
    ? t(`${P}.deleteTitle`, { count: profiles.length })
    : t(operation === 'update' ? `${P}.updateTitle` : `${P}.createTitle`)

  return (
    <div className="mx-3 mb-1">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs">
          <Icon className={cn('size-3.5 shrink-0', operation === 'delete' ? 'text-destructive' : 'text-foreground')} />
          <span className="shrink-0 font-medium text-foreground">{title}</span>
          {operation !== 'delete' && subject ? (
            <span className="ml-auto min-w-0 truncate text-muted-foreground">{harnessLabel(subject)}</span>
          ) : null}
        </div>

        {operation === 'delete' ? (
          <div className="mb-3 space-y-1.5">
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5">
              {profiles.map((profile, index) => (
                <div key={profile.id ?? index} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Bot className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{profile.name}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{harnessLabel(profile)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t(`${P}.deleteNote`)}</p>
          </div>
        ) : (
          <div className="mb-3 max-h-[min(50vh,24rem)] overflow-y-auto rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
            {operation === 'update' && subject ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Bot className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{subject.name}</span>
                </div>
                {(payload.changes ?? []).map((change) => <ChangeRow key={change.field} change={change} />)}
              </div>
            ) : subject ? (
              <ProfileBody view={subject} />
            ) : null}
          </div>
        )}

        <ApproveRejectBar
          approveRef={approveRef}
          rejectRef={rejectRef}
          feedbackRef={feedbackRef}
          onApprove={onConfirm}
          onReject={reject}
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

export function AgentProfileConfirmPromptContainer({ request }: { request: PermissionRequest }) {
  const { respondToPermission } = useScopedSessionActions()
  const payload = request.agentProfileConfirm
  // formAnswers (7th arg) reaches resolveAgentProfileConfirm as content; feedback rides it.
  const handleConfirm = useCallback(() => {
    void respondToPermission(request.requestId, true, undefined, undefined, undefined, undefined, {})
  }, [request.requestId, respondToPermission])
  const handleReject = useCallback((feedback?: string) => {
    void respondToPermission(request.requestId, false, undefined, feedback, undefined, undefined, feedback ? { feedback } : {})
  }, [request.requestId, respondToPermission])
  if (!payload) return null
  return <AgentProfileConfirmPrompt payload={payload} onConfirm={handleConfirm} onReject={handleReject} />
}
