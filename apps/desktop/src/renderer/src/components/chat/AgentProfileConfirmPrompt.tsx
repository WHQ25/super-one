/**
 * HITL prompt for agent_profile_apply / agent_profile_delete.
 *
 * Create is an editable form: the agent proposes, the user can change name,
 * description, instructions and how the agent runs with the composer's own
 * launch controls before saving. Update shows only the fields that change as
 * before → after, delete lists the agents in the destructive style. The
 * harness is fixed and shown as the glyph in front of each profile name.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Pencil, Trash2 } from 'lucide-react'
import type {
  AgentProfileConfirmChange,
  AgentProfileConfirmEditor,
  AgentProfileConfirmPayload,
  AgentProfileConfirmView,
  AgentProfileDraft,
  PermissionMode,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { AGENT_PROFILE_DRAFT_FIELD } from '@superone/shared/agent-types'
import { acpAgentDisplayName } from '@superone/shared/acp-brand'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import {
  AGENT_PROFILE_DESCRIPTION_MAX,
  AGENT_PROFILE_INSTRUCTIONS_MAX,
  AGENT_PROFILE_NAME_MAX,
  launchDefaultsFromConfig,
} from '@superone/shared/agent-profile'
import {
  agentProfileOptionRows,
  agentProfileOptionsForModel,
  isModelBoundOption,
  setAgentProfileOptionRow,
  type AgentProfileOptionKey,
} from '@superone/shared/agent-profile-options'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { cn } from '@superone/ui/lib/utils'
import { useScopedSessionActions } from '@/stores/chat'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import type { LaunchModelPatch } from '@/harness-ui/launch-model'
import { ExpandablePrompt } from './AutomationConfirmPrompt'
import { HarnessGlyph, LaunchSettingsBar } from './launch-settings-bar'
import { ApproveRejectBar } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { shouldSuppressDecisionShortcut, wasChatInputFocusedRecently } from './composer-slot/decision-composer-policy'

const P = 'chat.permission.agentProfile'

/** Text and its editor share box metrics, so switching between them does not move the layout. */
const TEXT_BOX = '-mx-1.5 block w-[calc(100%+0.75rem)] rounded px-1.5 py-1 text-left text-xs leading-4'
const FIELD_CLASS = cn(
  TEXT_BOX,
  'min-h-6 border-0 bg-muted text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring md:text-xs',
)

function harnessLabel(view: Pick<AgentProfileConfirmView, 'harnessId' | 'acpAgentId'>): string {
  const harness = HARNESS_CAPABILITIES[view.harnessId]?.displayName ?? view.harnessId
  return view.acpAgentId ? `${harness} · ${acpAgentDisplayName(view.acpAgentId)}` : harness
}

/** The profile's fixed harness, in front of its name. */
function ProfileGlyph({ view }: { view: AgentProfileConfirmView }) {
  return (
    <span title={harnessLabel(view)} className="flex shrink-0">
      <HarnessGlyph profile={view} />
    </span>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs leading-snug">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 break-words text-foreground">{children}</div>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

/**
 * Text that turns into its editor on click and back on blur, Enter (single
 * line) or Escape. Focus returns to the text, so the card's shortcuts keep working.
 */
function EditableText({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  multiline = false,
  invalid = false,
  textClassName,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  maxLength: number
  multiline?: boolean
  invalid?: boolean
  /** Extra classes on the read view's text, e.g. a line clamp. */
  textClassName?: string
}) {
  const [editing, setEditing] = useState(false)
  const textRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)

  useEffect(() => {
    if (!editing && wasEditing.current) textRef.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])

  if (!editing) {
    return (
      <button
        ref={textRef}
        type="button"
        aria-label={label}
        onClick={() => setEditing(true)}
        className={cn(TEXT_BOX, 'cursor-text transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring')}
      >
        {value.trim()
          ? <span className={cn('block whitespace-pre-wrap break-words', textClassName)}>{value}</span>
          : <span className={cn('block', invalid ? 'text-destructive' : 'text-muted-foreground')}>{placeholder}</span>}
      </button>
    )
  }

  const leave = () => setEditing(false)
  const field = {
    autoFocus: true,
    maxLength,
    placeholder,
    'aria-label': label,
    'aria-invalid': invalid,
    onBlur: leave,
    // The caret lands at the end, where an edit usually continues.
    onFocus: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const end = event.currentTarget.value.length
      event.currentTarget.setSelectionRange(end, end)
    },
  }
  return multiline ? (
    <AutoResizeTextarea
      {...field}
      value={value}
      onValueChange={onChange}
      maxRows={10}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        leave()
      }}
      className={FIELD_CLASS}
    />
  ) : (
    <input
      {...field}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && !(event.key === 'Enter' && !event.nativeEvent.isComposing)) return
        event.preventDefault()
        leave()
      }}
      className={cn(FIELD_CLASS, 'h-6')}
    />
  )
}

/** The draft can be saved: what the host's spec parser requires. */
function isDraftValid(draft: AgentProfileDraft): boolean {
  return !!draft.name.trim() && !!draft.description.trim()
}

/** Name, description, how it runs and instructions of a new profile, each editable before it is saved. */
function ProfileEditor({
  view,
  editor,
  draft,
  onChange,
}: {
  view: AgentProfileConfirmView
  editor: AgentProfileConfirmEditor
  draft: AgentProfileDraft
  onChange: (patch: Partial<AgentProfileDraft>) => void
}) {
  const { t } = useTranslation()
  const { agent, catalog } = editor
  const defaults = agent?.defaultConfig
  const { LaunchModelControl } = HARNESS_CONTROLS[view.harnessId]
  // An unset field shows what a launch would start with; it stays unset until the user picks.
  const model = draft.model ?? defaults?.model
  const optionDefaults = useMemo(() => launchDefaultsFromConfig(defaults).options, [defaults])
  const optionParams = useMemo(
    () => agentProfileOptionRows(view.harnessId, catalog, model, draft.options, optionDefaults, {
      field: (key) => t(`${P}.fields.${key}`),
      userDefault: t(`${P}.userDefault`),
      on: t(`${P}.on`),
      off: t(`${P}.off`),
    }),
    [view.harnessId, catalog, model, draft.options, optionDefaults, t],
  )

  const changeModel = (patch: LaunchModelPatch) => {
    const next: Partial<AgentProfileDraft> = {}
    if (patch.model && patch.model !== draft.model) {
      next.model = patch.model
      next.options = agentProfileOptionsForModel(view.harnessId, catalog, patch.model, draft.options)
    }
    if (patch.effort) next.effort = patch.effort
    if (Object.keys(next).length) onChange(next)
  }

  const changeOption = (rowId: string, value: string) => {
    // A model-bound option is only valid for the model it was picked on, so that model is pinned too.
    const key = rowId.split('.')[0] as AgentProfileOptionKey
    onChange({
      options: setAgentProfileOptionRow(draft.options, rowId, value),
      ...(!draft.model && model && isModelBoundOption(key) ? { model } : {}),
    })
  }

  return (
    <div className="space-y-1.5" data-profile-editor="">
      <div className="flex min-w-0 items-center gap-2.5 px-1.5 font-medium">
        <ProfileGlyph view={view} />
        <div className="min-w-0 flex-1">
          <EditableText
            value={draft.name}
            onChange={(name) => onChange({ name })}
            label={t(`${P}.fields.name`)}
            placeholder={t(`${P}.namePlaceholder`)}
            maxLength={AGENT_PROFILE_NAME_MAX}
            invalid={!draft.name.trim()}
            textClassName="truncate whitespace-nowrap"
          />
        </div>
      </div>
      <div className="px-1.5 text-foreground/90">
        <EditableText
          value={draft.description}
          onChange={(description) => onChange({ description })}
          label={t(`${P}.fields.description`)}
          placeholder={t(`${P}.descriptionPlaceholder`)}
          maxLength={AGENT_PROFILE_DESCRIPTION_MAX}
          multiline
          invalid={!draft.description.trim()}
        />
      </div>
      <LaunchSettingsBar
        harnessId={view.harnessId}
        settings={{ permissionMode: draft.permissionMode ?? defaults?.permissionMode }}
        offerSandbox={false}
        onChange={(patch) => {
          if (patch.permissionMode) onChange({ permissionMode: patch.permissionMode as PermissionMode })
        }}
      >
        <LaunchModelControl
          profile={agent}
          catalog="local"
          acpAgentId={view.acpAgentId ?? null}
          apiProviderId={defaults?.apiProviderId}
          hideApiProvider
          model={model}
          effort={draft.effort ?? defaults?.effort}
          optionParams={optionParams}
          onOptionParamChange={changeOption}
          onChange={changeModel}
        />
      </LaunchSettingsBar>
      <div className="px-1.5 pt-0.5">
        <div className="text-xs text-muted-foreground">{t(`${P}.fields.instructions`)}</div>
        <EditableText
          value={draft.instructions ?? ''}
          onChange={(instructions) => onChange({ instructions })}
          label={t(`${P}.fields.instructions`)}
          placeholder={t(`${P}.instructionsPlaceholder`)}
          maxLength={AGENT_PROFILE_INSTRUCTIONS_MAX}
          multiline
          textClassName="line-clamp-6"
        />
      </div>
    </div>
  )
}

/** A host display value: toggles arrive as `on` / `off` and are translated here. */
function optionText(raw: string | undefined, t: (key: string) => string): string | undefined {
  if (!raw) return undefined
  return raw === 'on' || raw === 'off' ? t(`${P}.${raw}`) : raw
}

function changeText(
  change: AgentProfileConfirmChange,
  side: 'from' | 'to',
  view: AgentProfileConfirmView,
  t: (key: string) => string,
): string | undefined {
  const raw = change[side]
  if (!raw) return undefined
  if (change.field === 'effort') return formatEffortLabel(raw)
  if (change.field === 'permissionMode') {
    // The harness's own vocabulary (Codex presets, Cursor agent mode), as its picker shows it.
    const labelKey = HARNESS_CONTROLS[view.harnessId].launchPermission?.(raw as PermissionMode, () => {}).labelKey
    return labelKey ? t(labelKey) : raw
  }
  if (['name', 'description', 'instructions', 'model'].includes(change.field)) return raw
  return optionText(raw, t)
}

function ChangeRow({ change, view }: { change: AgentProfileConfirmChange; view: AgentProfileConfirmView }) {
  const { t } = useTranslation()
  const from = changeText(change, 'from', view, t)
  const to = changeText(change, 'to', view, t)
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

/** Keys inside the create form drive its fields and pickers; the card's shortcuts apply elsewhere. */
function isEditorField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('[data-profile-editor]')
}

export function AgentProfileConfirmPrompt({
  payload,
  onConfirm,
  onReject,
}: {
  payload: AgentProfileConfirmPayload
  /** `draft` is the create form's content when the payload offers editing. */
  onConfirm: (draft?: AgentProfileDraft) => void
  onReject: (feedback?: string) => void
}) {
  const { t } = useTranslation()
  const chatRootRef = useChatRootRef()
  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)
  const { operation, profiles, editor } = payload
  const subject = profiles[0]
  const [draft, setDraft] = useState(editor?.draft)
  const canApprove = !draft || isDraftValid(draft)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!canAutofocusInChatRoot(chatRootRef?.current) || wasChatInputFocusedRecently(chatRootRef?.current)) return
      approveRef.current?.focus()
    })
  }, [chatRootRef, operation, profiles.length])

  const confirm = useCallback(() => {
    if (canApprove) onConfirm(draft)
  }, [canApprove, draft, onConfirm])
  const reject = useCallback(() => onReject(feedback.trim() || undefined), [feedback, onReject])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (shouldSuppressDecisionShortcut(e, chatRootRef?.current)) return
      if (hasOpenRadixOverlay() || isEditorField(e.target)) return
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (feedbackFocused) reject()
        else confirm()
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
  }, [chatRootRef, feedbackFocused, confirm, reject])

  const Icon = operation === 'delete' ? Trash2 : operation === 'update' ? Pencil : Bot
  const title = operation === 'delete'
    ? t(`${P}.deleteTitle`, { count: profiles.length })
    : t(operation === 'update' ? `${P}.updateTitle` : `${P}.createTitle`)

  return (
    <div className="mx-3 mb-1 flex min-h-0 flex-col">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex min-w-0 shrink-0 items-center gap-1.5 text-xs">
          <Icon className={cn('size-3.5 shrink-0', operation === 'delete' ? 'text-destructive' : 'text-foreground')} />
          <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
        </div>

        {/* -mt-1 pt-1 keeps the editor's negative top margin inside this scroll box. */}
        <div className="-mx-3 -mt-1 min-h-0 overflow-y-auto px-3 pt-1">
        {operation === 'delete' ? (
          <div className="mb-3 space-y-1.5">
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5">
              {profiles.map((profile, index) => (
                <div key={profile.id ?? index} className="flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-xs">
                  <ProfileGlyph view={profile} />
                  <span className="truncate font-medium text-foreground">{profile.name}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t(`${P}.deleteNote`)}</p>
          </div>
        ) : operation === 'update' && subject ? (
          <div className="mb-3 max-h-[min(50vh,24rem)] space-y-1.5 overflow-y-auto rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
              <ProfileGlyph view={subject} />
              <span className="min-w-0 truncate">{subject.name}</span>
            </div>
            {(payload.changes ?? []).map((change) => <ChangeRow key={change.field} change={change} view={subject} />)}
          </div>
        ) : subject && editor && draft ? (
          // A scroll box clips both axes: its padding is the room the fields' focus rings draw in,
          // offset by the negative margin so the fields stay where they were.
          <div className="-mx-1 -mt-1 mb-2 max-h-[min(60vh,32rem)] overflow-y-auto p-1">
            <ProfileEditor
              view={subject}
              editor={editor}
              draft={draft}
              onChange={(patch) => setDraft((current) => current && { ...current, ...patch })}
            />
          </div>
        ) : null}
        </div>

        <div className="shrink-0">
        <ApproveRejectBar
          approveRef={approveRef}
          rejectRef={rejectRef}
          feedbackRef={feedbackRef}
          onApprove={confirm}
          onReject={reject}
          approveDisabled={!canApprove}
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
    </div>
  )
}

export function AgentProfileConfirmPromptContainer({ request }: { request: PermissionRequest }) {
  const { respondToPermission } = useScopedSessionActions()
  const payload = request.agentProfileConfirm
  // formAnswers (7th arg) reaches resolveAgentProfileConfirm as content; the edited draft and feedback ride it.
  const handleConfirm = useCallback((draft?: AgentProfileDraft) => {
    const content = draft ? { [AGENT_PROFILE_DRAFT_FIELD]: JSON.stringify(draft) } : {}
    void respondToPermission(request.requestId, true, undefined, undefined, undefined, undefined, content)
  }, [request.requestId, respondToPermission])
  const handleReject = useCallback((feedback?: string) => {
    void respondToPermission(request.requestId, false, undefined, feedback, undefined, undefined, feedback ? { feedback } : {})
  }, [request.requestId, respondToPermission])
  if (!payload) return null
  return <AgentProfileConfirmPrompt payload={payload} onConfirm={handleConfirm} onReject={handleReject} />
}
