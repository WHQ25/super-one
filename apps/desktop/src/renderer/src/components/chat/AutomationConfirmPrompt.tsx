/**
 * HITL prompt for automation create / update / delete.
 *
 * Create / update reuse the collab confirm config strip
 * (GroupedModelEffortSelector + HarnessPermissionPopover + SandboxModePopover)
 * so users retune model / effort / permission / sandbox with the same controls
 * as multi-agent launch. Accept sends the edited agentConfig via formAnswers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import { CalendarClock, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import type {
  AgentRunConfig,
  AutomationConfirmAgentView,
  AutomationConfirmItem,
  AutomationConfirmPayload,
  EffortLevel,
  HarnessId,
  PermissionMode,
  PermissionRequest,
  SandboxMode,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { getCachedAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { modes } from './PermissionModeList'
import { harnessSupportsSandbox, sandboxModes, SandboxModePopover } from './SandboxModeSelector'
import { formatCodexModelName, formatReasoningEffortLabel } from './chat-input-utils'
import { ApproveRejectBar } from './PermissionActionBar'
import { HarnessPermissionPopover } from './HarnessPermissionPopover'
import { GroupedModelEffortSelector } from './model-selector/GroupedModelEffortSelector'
import { useCollabLaunchModelSelector } from './model-selector/useCollabLaunchModelSelector'
import {
  streamdownComponents,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
} from './chat-shared'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

/** Editable agent knobs — same surface as collab launch confirm. */
type EditableAgent = Pick<
  AutomationConfirmAgentView,
  'model' | 'effort' | 'permissionMode' | 'sandboxMode' | 'apiProviderId' | 'permissionPreset' | 'acpAgentId'
>

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center text-xs leading-none">
      <span className="mr-2 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </div>
  )
}

function ModeChip({
  icon,
  label,
  color,
  activeBg,
}: {
  icon: React.ReactNode
  label: string
  color: string
  activeBg: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
        color,
        activeBg,
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  )
}

function harnessLabel(type: AutomationConfirmAgentView['type']): string {
  switch (type) {
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'acp':
      return 'ACP'
    case 'opencode':
      return 'OpenCode'
    default:
      return type
  }
}

/** Read-only chips for delete rows (create/update use the collab strip). */
function AgentViewChips({ agent }: { agent: AutomationConfirmAgentView }) {
  const { t } = useTranslation()
  const claudeModels = useChatStore((s) => s.harnessResources.claude?.models)
  const codexModels = useChatStore((s) => s.harnessResources.codex?.models)

  const modelLabel = useMemo(() => {
    if (!agent.model) return null
    if (agent.type === 'codex') {
      const found = codexModels?.find((m) => m.id === agent.model)
      return formatCodexModelName(found?.name, agent.model)
    }
    if (agent.type === 'claude') {
      const found = claudeModels?.find((m) => m.id === agent.model)
      return found?.name ?? agent.model
    }
    return agent.model
  }, [agent.model, agent.type, claudeModels, codexModels])

  const effortLabel = agent.effort
    ? (agent.type === 'codex'
        ? formatReasoningEffortLabel(agent.effort)
        : (t(`settings.preferences.effort.levels.${agent.effort}`, {
            defaultValue: agent.effort,
          }) as string))
    : null

  const permissionMode = agent.permissionMode
    ? modes.find((m) => m.id === agent.permissionMode)
    : undefined
  const sandboxMode = agent.sandboxMode
    ? sandboxModes.find((m) => m.id === agent.sandboxMode)
    : undefined

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
        {harnessLabel(agent.type)}
        {agent.type === 'acp' && agent.acpAgentId ? ` · ${agent.acpAgentId}` : ''}
      </span>
      {permissionMode ? (
        <ModeChip
          icon={permissionMode.icon}
          label={t(`chat.permissionModes.${permissionMode.id}.label`)}
          color={permissionMode.color}
          activeBg={permissionMode.activeBg}
        />
      ) : null}
      {sandboxMode ? (
        <ModeChip
          icon={sandboxMode.icon}
          label={t(`chat.sandboxModes.${sandboxMode.id}.label`)}
          color={sandboxMode.color}
          activeBg={sandboxMode.activeBg}
        />
      ) : null}
      {modelLabel ? (
        <span className="inline-flex items-center rounded-md bg-muted/80 px-1.5 py-0.5 text-xs text-foreground">
          {modelLabel}
        </span>
      ) : null}
      {effortLabel ? (
        <span className="inline-flex items-center rounded-md bg-muted/80 px-1.5 py-0.5 text-xs text-muted-foreground">
          {effortLabel}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Collab-style config strip: model/effort + permission + sandbox.
 * Driven by props so the confirm UI does not touch the parent chat session.
 */
function AgentConfigStrip({
  agentType,
  acpAgentId,
  value,
  onChange,
}: {
  agentType: AutomationConfirmAgentView['type']
  acpAgentId?: string | null
  value: EditableAgent
  onChange: (patch: EditableAgent) => void
}) {
  const sandboxCapability = useAppStore((s) => s.sandboxCapability)
  const acpResources = useChatStore((s) => s.harnessResources.acp)
  const harnessId = agentType as HarnessId

  const profile = useMemo((): SessionAgentProfile | undefined => {
    if (agentType !== 'acp') return undefined
    const agentId = acpAgentId ?? value.acpAgentId ?? acpResources?.selectedAgentId ?? null
    if (!agentId) return undefined
    const catalog = getCachedAcpCatalog(acpResources, agentId)
    const models = catalog?.models?.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      ...(m.description ? { description: m.description } : {}),
    })) ?? []
    // Grok-style modes with null configId act as effort chips in the collab selector.
    const efforts = (catalog?.modes ?? [])
      .filter((m) => !('configId' in m) || (m as { configId?: string | null }).configId == null)
      .map((m) => m.id)
    return {
      id: agentId,
      name: agentId,
      harnessId: 'acp',
      acpAgentId: agentId,
      brandKey: agentId.startsWith('grok') ? 'acp-grok' : 'acp',
      defaultConfig: {},
      models,
      efforts,
      apiProviders: [],
    }
  }, [agentType, acpAgentId, value.acpAgentId, acpResources])

  const modelSelector = useCollabLaunchModelSelector({
    harnessId,
    profile,
    apiProviderId: value.apiProviderId,
    selectedModelId: value.model,
    selectedEffort: value.effort,
    onChange: (patch) => onChange(patch),
  })

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/20 px-1 py-0.5">
      <GroupedModelEffortSelector
        models={modelSelector.models}
        modelGroups={modelSelector.modelGroups}
        selectedModelId={modelSelector.selectedModelId}
        selectedModelLabel={modelSelector.selectedModelLabel}
        onSelectModel={modelSelector.onSelectModel}
        shouldCloseAfterModelSelect={modelSelector.shouldCloseAfterModelSelect}
        effortOptions={modelSelector.effortOptions}
        selectedEffort={modelSelector.selectedEffort}
        selectedEffortLabel={modelSelector.selectedEffortLabel}
        onSelectEffort={modelSelector.onSelectEffort}
        providers={modelSelector.providers}
        selectedProviderId={modelSelector.selectedProviderId}
        onSelectProvider={modelSelector.onSelectProvider}
        onManageProviders={modelSelector.onManageProviders}
        onRefreshModels={modelSelector.onRefreshModels}
        modelsLoading={modelSelector.modelsLoading}
        triggerLabel={modelSelector.triggerLabel}
      />
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
      <HarnessPermissionPopover
        harnessId={harnessId}
        value={value.permissionMode ?? 'default'}
        onChange={(permissionMode: PermissionMode) => onChange({ permissionMode })}
      />
      {harnessSupportsSandbox(harnessId) && (
        <>
          <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
          <SandboxModePopover
            value={value.sandboxMode ?? 'off'}
            onValueChange={(sandboxMode: SandboxMode) => onChange({ sandboxMode })}
            supportLevel={sandboxCapability?.supportLevel ?? 'always'}
          />
        </>
      )}
    </div>
  )
}

/** Convert confirm UI edits → AgentRunConfig for formAnswers / persistence. */
export function agentViewToRunConfig(
  type: AutomationConfirmAgentView['type'],
  base: AutomationConfirmAgentView | undefined,
  edits: EditableAgent,
): AgentRunConfig {
  const model = edits.model ?? base?.model
  const effort = edits.effort ?? base?.effort
  const permissionMode = edits.permissionMode ?? base?.permissionMode
  const sandboxMode = edits.sandboxMode ?? base?.sandboxMode
  const apiProviderId = edits.apiProviderId !== undefined ? edits.apiProviderId : base?.apiProviderId
  const acpAgentId = edits.acpAgentId ?? base?.acpAgentId

  if (type === 'claude') {
    return {
      type: 'claude',
      ...(model ? { model } : {}),
      ...(effort ? { effort: effort as EffortLevel } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(sandboxMode ? { sandboxMode } : {}),
      ...(apiProviderId !== undefined ? { apiProviderId } : {}),
    }
  }
  if (type === 'codex') {
    const permissionPreset =
      edits.permissionPreset
      ?? base?.permissionPreset
      ?? (permissionMode === 'bypassPermissions' || permissionMode === 'acceptEdits'
        ? 'full-access'
        : 'default')
    return {
      type: 'codex',
      ...(model ? { model } : {}),
      ...(effort
        ? {
            effort,
            reasoningEffort: effort as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
          }
        : {}),
      permissionMode: permissionMode ?? (permissionPreset === 'full-access' ? 'bypassPermissions' : 'default'),
      permissionPreset,
      ...(apiProviderId !== undefined ? { apiProviderId } : {}),
    }
  }
  if (type === 'acp') {
    return {
      type: 'acp',
      ...(acpAgentId ? { acpAgentId } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(apiProviderId !== undefined ? { apiProviderId } : {}),
    }
  }
  return {
    type: 'opencode',
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(apiProviderId !== undefined ? { apiProviderId } : {}),
  }
}

function initialEditable(agent: AutomationConfirmAgentView | undefined): EditableAgent {
  if (!agent) {
    return {
      permissionMode: 'bypassPermissions',
      sandboxMode: 'off',
    }
  }
  return {
    model: agent.model,
    effort: agent.effort,
    permissionMode: agent.permissionMode,
    sandboxMode: agent.sandboxMode,
    apiProviderId: agent.apiProviderId,
    permissionPreset: agent.permissionPreset,
    acpAgentId: agent.acpAgentId,
  }
}

function resolveEditableAgent(
  payload: AutomationConfirmPayload,
): { type: AutomationConfirmAgentView['type']; base?: AutomationConfirmAgentView } | null {
  if (payload.operation === 'delete') return null
  const itemAgent = payload.items[0]?.agent
  if (payload.operation === 'update') {
    const agentChange = payload.changes?.find((c) => c.field === 'agent')
    const to = agentChange?.agentTo ?? itemAgent
    if (to) return { type: to.type, base: to }
    if (itemAgent) return { type: itemAgent.type, base: itemAgent }
    return null
  }
  // create
  if (itemAgent) return { type: itemAgent.type, base: itemAgent }
  return { type: 'claude', base: { type: 'claude', permissionMode: 'bypassPermissions', sandboxMode: 'off' } }
}

function PromptMarkdown({ text }: { text: string }) {
  return (
    <div className="github-md text-xs leading-snug text-foreground/90 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-1.5 [&_pre]:text-[11px]">
      <Streamdown
        plugins={streamdownPlugins}
        components={streamdownComponents}
        controls={streamdownControls}
        linkSafety={streamdownLinkSafety}
      >
        {text}
      </Streamdown>
    </div>
  )
}

/**
 * Collapsed: 2-line plain summary (click to expand).
 * Expanded: Markdown with max-height + scroll — same grammar as collab task preview.
 */
function ExpandablePrompt({
  prompt,
  preview,
}: {
  prompt?: string
  preview?: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const full = (prompt ?? preview ?? '').trim()
  if (!full) return null

  const collapsedLabel = (preview ?? full.split(/\n/, 1)[0] ?? full).trim() || full

  return (
    <div
      className={cn(
        'min-h-0 transition-[max-height] duration-300 ease-out',
        expanded
          ? 'flex max-h-[min(40vh,16rem)] flex-col overflow-hidden rounded-md border border-border/60 bg-muted/15'
          : 'max-h-12',
      )}
    >
      {expanded ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            title={t('chat.sessionAgentsConfirm.collapseTask')}
            className="line-clamp-2 shrink-0 border-b border-border/50 px-2 py-1 text-left text-[11px] leading-snug text-muted-foreground hover:text-foreground"
          >
            {collapsedLabel}
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5">
            <PromptMarkdown text={full} />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={t('chat.sessionAgentsConfirm.expandTask')}
          className="block w-full cursor-pointer text-left"
        >
          <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90">
            {collapsedLabel}
          </span>
        </button>
      )}
    </div>
  )
}

function ItemCard({
  item,
  hideAgent,
  enabled,
  onEnabledChange,
}: {
  item: AutomationConfirmItem
  /** When true, agent is edited in the collab strip below. */
  hideAgent?: boolean
  /** Resolved enabled state (editable for create/update). */
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const showEnabled = enabled !== undefined || item.enabled !== undefined
  const enabledValue = enabled ?? item.enabled ?? false

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <CalendarClock className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {showEnabled ? (
          <Switch
            size="sm"
            className="ml-auto shrink-0"
            checked={enabledValue}
            onCheckedChange={onEnabledChange}
            disabled={!onEnabledChange}
            title={enabledValue
              ? t('chat.permission.automationEnabledOn')
              : t('chat.permission.automationEnabledOff')}
            aria-label={t('chat.permission.automationFieldEnabled')}
          />
        ) : null}
      </div>
      {item.scheduleSummary ? (
        <FieldRow label={t('chat.permission.automationFieldSchedule')}>
          <span className="text-foreground">{item.scheduleSummary}</span>
        </FieldRow>
      ) : null}
      {!hideAgent && item.agent ? (
        <FieldRow label={t('chat.permission.automationFieldAgent')}>
          <AgentViewChips agent={item.agent} />
        </FieldRow>
      ) : !hideAgent && (item.agentSummary || item.agentType) ? (
        <FieldRow label={t('chat.permission.automationFieldAgent')}>
          <span className="text-foreground">{item.agentSummary || item.agentType}</span>
        </FieldRow>
      ) : null}
      {(item.prompt || item.promptPreview) ? (
        <ExpandablePrompt
          key={`${item.id ?? item.name}-prompt`}
          prompt={item.prompt}
          preview={item.promptPreview}
        />
      ) : null}
    </div>
  )
}

export type AutomationConfirmResult = {
  agentConfig?: AgentRunConfig
  enabled?: boolean
}

export function AutomationConfirmPrompt({
  payload,
  onConfirm,
  onReject,
}: {
  payload: AutomationConfirmPayload
  onConfirm: (result?: AutomationConfirmResult) => void
  onReject: (feedback?: string) => void
}) {
  const { t } = useTranslation()
  const items = payload.items ?? []
  const changes = payload.changes ?? []
  const op = payload.operation
  const chatRootRef = useChatRootRef()
  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)

  const editableSource = useMemo(() => resolveEditableAgent(payload), [payload])
  const [agentEdits, setAgentEdits] = useState<EditableAgent>(() =>
    initialEditable(editableSource?.base),
  )
  const [enabledEdit, setEnabledEdit] = useState<boolean | undefined>(() => items[0]?.enabled)

  // Reset edits when a new permission request arrives.
  useEffect(() => {
    setAgentEdits(initialEditable(editableSource?.base))
    setEnabledEdit(items[0]?.enabled)
  }, [editableSource?.base, payload.operation, items[0]?.id, items[0]?.name, items[0]?.enabled])

  const handleConfirm = useCallback(() => {
    const result: AutomationConfirmResult = {}
    if (editableSource) {
      result.agentConfig = agentViewToRunConfig(editableSource.type, editableSource.base, agentEdits)
    }
    if (enabledEdit !== undefined) result.enabled = enabledEdit
    if (result.agentConfig || result.enabled !== undefined) {
      onConfirm(result)
      return
    }
    onConfirm()
  }, [agentEdits, editableSource, enabledEdit, onConfirm])

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!canAutofocusInChatRoot(chatRootRef?.current)) return
      approveRef.current?.focus()
    })
  }, [chatRootRef, op, items.length])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (hasOpenRadixOverlay()) return
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (feedbackFocused) {
          onReject(feedback.trim() || undefined)
        } else {
          handleConfirm()
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
  }, [chatRootRef, feedback, feedbackFocused, handleConfirm, onReject])

  let Icon = Plus
  let title = t('chat.permission.automationCreateTitle')
  let iconClass = 'text-foreground'
  if (op === 'update') {
    Icon = changes.length === 1 && changes[0]?.field === 'enabled' ? Power : Pencil
    title = t('chat.permission.automationUpdateTitle')
  } else if (op === 'delete') {
    Icon = Trash2
    title = t('chat.permission.automationDeleteTitle', { count: items.length })
    iconClass = 'text-destructive'
  }

  const showAgentStrip = !!editableSource

  return (
    <div className="mx-3 mb-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs">
          <Icon className={cn('size-3.5 shrink-0', iconClass)} />
          <span className="font-medium text-foreground">{title}</span>
          {editableSource ? (
            <span className="ml-auto truncate text-[11px] text-muted-foreground">
              {harnessLabel(editableSource.type)}
              {editableSource.type === 'acp' && (agentEdits.acpAgentId ?? editableSource.base?.acpAgentId)
                ? ` · ${agentEdits.acpAgentId ?? editableSource.base?.acpAgentId}`
                : ''}
            </span>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="mb-3 rounded border border-border/50 bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
            {t('chat.permission.automationEmpty')}
          </div>
        ) : op === 'delete' ? (
          <div className="mb-3 max-h-48 space-y-0.5 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5">
            {items.map((item, i) => (
              <div
                key={item.id ?? `${item.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <CalendarClock className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">{item.name}</span>
                </span>
                {item.scheduleSummary ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {item.scheduleSummary}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          // create + update: one thin frame, compact padding (ItemCard has no extra pad)
          <div className="mb-3 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
            {items[0] ? (
              <ItemCard
                item={items[0]}
                hideAgent={showAgentStrip}
                enabled={enabledEdit}
                onEnabledChange={setEnabledEdit}
              />
            ) : null}
          </div>
        )}

        {showAgentStrip && editableSource ? (
          <div className="mb-3 space-y-1">
            <div className="text-[11px] text-muted-foreground">
              {t('chat.permission.automationFieldAgent')}
            </div>
            <AgentConfigStrip
              agentType={editableSource.type}
              acpAgentId={editableSource.base?.acpAgentId}
              value={agentEdits}
              onChange={(patch) => setAgentEdits((cur) => ({ ...cur, ...patch }))}
            />
          </div>
        ) : null}

        <ApproveRejectBar
          approveRef={approveRef}
          rejectRef={rejectRef}
          feedbackRef={feedbackRef}
          onApprove={handleConfirm}
          onReject={() => onReject(feedback.trim() || undefined)}
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

export function AutomationConfirmPromptContainer({
  request,
}: {
  request: PermissionRequest
}) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const payload = request.automationConfirm

  // formAnswers is the 7th arg — session.ts hands it to resolveAutomationConfirm as content.
  const respond = useCallback((allow: boolean, content: Record<string, unknown>, feedback?: string) => {
    void respondToPermission(
      request.requestId,
      allow,
      undefined,
      feedback,
      undefined,
      undefined,
      content,
    )
  }, [request.requestId, respondToPermission])

  const handleConfirm = useCallback((result?: AutomationConfirmResult) => {
    const content: Record<string, unknown> = {}
    if (result?.agentConfig) content.agentConfig = result.agentConfig
    if (result?.enabled !== undefined) content.enabled = result.enabled
    respond(true, content)
  }, [respond])

  const handleReject = useCallback((feedback?: string) => {
    respond(false, feedback ? { feedback } : {}, feedback)
  }, [respond])

  if (!payload) return null

  return (
    <AutomationConfirmPrompt
      payload={payload}
      onConfirm={handleConfirm}
      onReject={handleReject}
    />
  )
}
