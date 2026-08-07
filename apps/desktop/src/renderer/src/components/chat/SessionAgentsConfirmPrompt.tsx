import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Bot, FolderClosed, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import type {
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
  SessionAgentRequestPayload,
  SessionAgentWorktreeConfig,
} from '@superone/shared/agent-types'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { useAppStore } from '@/stores/app'
import { HarnessPermissionPopover } from './HarnessPermissionPopover'
import { harnessSupportsSandbox, SandboxModePopover } from './SandboxModeSelector'
import { ApproveRejectBar } from './PermissionActionBar'
import { WorkDirLabel, workDirTitle, type WorkDirState } from './work-dir-label'
import { GroupedModelEffortSelector } from './model-selector/GroupedModelEffortSelector'
import { useCollabLaunchModelSelector } from './model-selector/useCollabLaunchModelSelector'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'

interface Props {
  payload: SessionAgentRequestPayload
  onConfirm: (launches: SessionAgentLaunchProposal[]) => void
  /** The deny reason is handed back to the agent as the tool result. */
  onReject: (feedback?: string) => void
}

/**
 * The user may only retune *how* a proposed session runs — model, effort, AI provider and
 * permission mode. Everything else (which agent, the task, cwd, worktree, sandbox) is the
 * requesting agent's decision and is rendered read-only.
 */
type EditableConfig = Pick<
  SessionAgentLaunchProposal['config'],
  'model' | 'effort' | 'apiProviderId' | 'permissionMode' | 'sandboxMode'
>

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/** Idle harness glyph, brand-aware for ACP agents (e.g. Grok → acp-grok icon). */
function HarnessGlyph({ profile }: { profile: SessionAgentProfile | undefined }) {
  const Icon = resolveSessionIconFromBrandKey(profile?.brandKey)
    ?? resolveSessionIcon(profile?.harnessId, profile?.acpAgentId)
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      {Icon
        ? <Icon status="default" renderLevel="compact" />
        : <Bot className="size-3 text-muted-foreground" />}
    </span>
  )
}

/** Tab labels show harness profile name (Claude / Grok / …); duplicate harnesses get a 1-based suffix. */
function buildTabLabels(launches: SessionAgentLaunchProposal[], profiles: SessionAgentProfile[]): string[] {
  const harnessOf = (launch: SessionAgentLaunchProposal): string =>
    profiles.find((profile) => profile.id === launch.agentId)?.name ?? launch.agentId
  const totals = new Map<string, number>()
  for (const launch of launches) totals.set(harnessOf(launch), (totals.get(harnessOf(launch)) ?? 0) + 1)
  const seen = new Map<string, number>()
  return launches.map((launch) => {
    const label = harnessOf(launch)
    if ((totals.get(label) ?? 0) < 2) return label
    const index = (seen.get(label) ?? 0) + 1
    seen.set(label, index)
    return `${label} ${index}`
  })
}

/** Agent-chosen display name + role for the content header (`Name - Role`). */
function launchNameRoleLine(launch: SessionAgentLaunchProposal): string {
  const name = (launch.name ?? launch.config.name)?.trim() || 'Agent'
  const role = (launch.role ?? launch.config.role)?.trim()
  return role ? `${name} - ${role}` : name
}

function MetaChip({
  icon: Icon,
  label,
  title,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  title?: string
}) {
  return (
    <span
      title={title ?? label}
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs leading-none text-muted-foreground"
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * A launch always describes a worktree that does not exist yet, so it maps onto the status
 * bar's *pending* vocabulary; no worktree means the session runs locally in its cwd.
 */
function workDirStateOf(worktree: SessionAgentWorktreeConfig | null): WorkDirState {
  if (!worktree) return { kind: 'local' }
  if (worktree.mode === 'detach') return { kind: 'createFrom', base: worktree.baseBranch }
  if (worktree.mode === 'attach') return { kind: 'attachTo', base: worktree.baseBranch }
  return { kind: 'createBranch', name: worktree.branchName ?? '' }
}

function LaunchPanel({
  launch,
  profile,
  onChange,
}: {
  launch: SessionAgentLaunchProposal
  profile: SessionAgentProfile | undefined
  onChange: (patch: EditableConfig) => void
}) {
  const { t } = useTranslation()
  const sandboxCapability = useAppStore((state) => state.sandboxCapability)
  const [taskExpanded, setTaskExpanded] = useState(false)
  const { config } = launch
  const harnessId = profile?.harnessId ?? 'claude'
  const modelSelector = useCollabLaunchModelSelector({
    harnessId,
    profile,
    apiProviderId: config.apiProviderId,
    selectedModelId: config.model,
    selectedEffort: config.effort,
    onChange,
  })
  const workDirState = workDirStateOf(config.worktree?.enabled ? config.worktree : null)

  const nameRole = launchNameRoleLine(launch)

  return (
    <div className="px-2.5 py-2">
      <div className="mb-1.5 text-xs font-medium text-foreground">{nameRole}</div>
      <button
        type="button"
        onClick={() => setTaskExpanded((expanded) => !expanded)}
        title={t(taskExpanded ? 'chat.sessionAgentsConfirm.collapseTask' : 'chat.sessionAgentsConfirm.expandTask')}
        className={cn(
          'block w-full cursor-pointer whitespace-pre-wrap break-words text-left text-xs leading-snug text-foreground/90',
          !taskExpanded && 'line-clamp-2',
        )}
      >
        {launch.task}
      </button>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {config.cwd && (
          <MetaChip
            icon={FolderClosed}
            label={basename(config.cwd)}
            title={`${t('chat.sessionAgentsConfirm.workingDirectory')}: ${config.cwd}`}
          />
        )}
        <span
          title={workDirTitle(workDirState, t)}
          className="inline-flex min-w-0 max-w-full items-center gap-0.5 truncate text-xs leading-none text-muted-foreground"
        >
          <WorkDirLabel state={workDirState} />
        </span>
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/20 px-1 py-0.5">
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
          value={config.permissionMode ?? 'default'}
          onChange={(permissionMode: PermissionMode) => onChange({ permissionMode })}
        />
        {harnessSupportsSandbox(harnessId) && (
          <>
            <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
            <SandboxModePopover
              value={config.sandboxMode ?? 'off'}
              onValueChange={(sandboxMode: SandboxMode) => onChange({ sandboxMode })}
              supportLevel={sandboxCapability?.supportLevel ?? 'always'}
            />
          </>
        )}
      </div>
    </div>
  )
}

export function SessionAgentsConfirmPrompt({ payload, onConfirm, onReject }: Props) {
  const { t } = useTranslation()
  const [overrides, setOverrides] = useState<Record<string, EditableConfig>>({})
  const [activeTab, setActiveTab] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)
  const feedbackRef = useRef<HTMLInputElement>(null)
  const chatRootRef = useChatRootRef()

  const { launches, profiles } = payload
  const tabLabels = useMemo(() => buildTabLabels(launches, profiles), [launches, profiles])
  const multiple = launches.length > 1
  const activeIndex = Math.min(activeTab, launches.length - 1)
  const activeLaunch = launches[activeIndex]

  const resolved = useMemo(
    () => launches.map((launch) => {
      const profile = profiles.find((item) => item.id === launch.agentId)
      return {
        ...launch,
        config: {
          ...profile?.defaultConfig,
          ...launch.config,
          ...overrides[launch.launchId],
        },
      }
    }),
    [launches, overrides, profiles],
  )

  const handleConfirm = useCallback(() => onConfirm(resolved), [onConfirm, resolved])
  const handleReject = useCallback(() => onReject(feedback.trim() || undefined), [onReject, feedback])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (hasOpenRadixOverlay()) return
      const typing = document.activeElement === feedbackRef.current

      // Tab walks the agent tabs and then the feedback field, so a single-agent prompt
      // behaves exactly like PermissionPrompt (Tab focuses the reason box).
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        if (typing) {
          feedbackRef.current?.blur()
          setActiveTab(event.shiftKey ? launches.length - 1 : 0)
          return
        }
        const next = event.shiftKey ? activeIndex - 1 : activeIndex + 1
        if (next < 0 || next >= launches.length) feedbackRef.current?.focus()
        else setActiveTab(next)
        return
      }

      if (typing) {
        // Same contract as PermissionPrompt: the feedback box submits a rejection.
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault()
          handleReject()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          feedbackRef.current?.blur()
        }
        return
      }

      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        handleConfirm()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        handleReject()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, launches.length, handleConfirm, handleReject, chatRootRef])

  if (!activeLaunch) return null

  return (
    <div className="@container mx-3 mb-2 overflow-hidden rounded-lg border border-primary/40 bg-card">
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <Users className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {t('chat.sessionAgentsConfirm.title')}
        </span>
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
          title={t('chat.sessionAgentsConfirm.subtitle', { count: launches.length })}
        >
          <Bot className="size-3 shrink-0" />
          {launches.length}
        </span>
      </div>

      {/* Agent identity: a tab strip when several were requested, a plain line for a single one.
          The strip is the only scrolling box, so the ⇥ hint stays pinned no matter how narrow. */}
      <div className={cn('mt-1.5 flex items-stretch gap-1 px-1.5', multiple && 'border-b border-border/50')}>
        <div role={multiple ? 'tablist' : undefined} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
        {launches.map((launch, index) => {
          const profile = profiles.find((item) => item.id === launch.agentId)
          const selected = index === activeIndex
          const body = (
            <>
              <HarnessGlyph profile={profile} />
              <span className="truncate">{tabLabels[index]}</span>
            </>
          )
          if (!multiple) {
            return (
              <span key={launch.launchId} className="flex min-w-0 items-center gap-1.5 px-1 py-1 text-xs font-medium text-foreground">
                {body}
              </span>
            )
          }
          return (
            <button
              key={launch.launchId}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setActiveTab(index)}
              className={cn(
                'flex min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2 py-1 text-xs font-medium transition-colors',
                selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {body}
            </button>
          )
        })}
        </div>
        {multiple && (
          <span className="flex shrink-0 items-center self-center pl-1 text-xs text-muted-foreground">
            <Kbd>⇥</Kbd>
            <span className="ml-0.5 hidden @[380px]:inline">{t('chat.sessionAgentsConfirm.hintSwitch')}</span>
          </span>
        )}
      </div>

      <LaunchPanel
        key={activeLaunch.launchId}
        launch={resolved[activeIndex]}
        profile={profiles.find((profile) => profile.id === activeLaunch.agentId)}
        onChange={(patch) => setOverrides((current) => ({
          ...current,
          [activeLaunch.launchId]: { ...current[activeLaunch.launchId], ...patch },
        }))}
      />

      <div className="border-t border-border/50 px-2.5 py-2">
        <ApproveRejectBar
          feedbackRef={feedbackRef}
          onApprove={handleConfirm}
          onReject={handleReject}
          approveLabel={t('chat.sessionAgentsConfirm.approve')}
          rejectLabel={t('chat.sessionAgentsConfirm.reject')}
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
