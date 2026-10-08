import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { AlertTriangle, Bot, FolderClosed, GitBranch, Loader2, MessageSquare, RefreshCw, Server, Users, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import {
  buildLaunchTabLabels,
  isHandoffLaunch,
  isLaunchModelOffered,
  isLinkLaunch,
  launchNameRoleLine,
  launchWorkDir,
  pathBasename,
  peerSessionTitle,
  shortSessionId,
} from '@superone/shared/collab-request-display'
import type {
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
  SessionAgentRemoteLaunch,
  SessionAgentRequestPayload,
} from '@superone/shared/agent-types'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { openPeerSession } from '@/lib/open-peer-session'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { useAppStore } from '@/stores/app'
import { HarnessPermissionPopover } from './HarnessPermissionPopover'
import { harnessSupportsSandbox, harnessSandboxModes, harnessSandboxSupportLevel, coerceSandboxModeForHarness, SandboxModePopover } from './SandboxModeSelector'
import { ApproveRejectBar } from './PermissionActionBar'
import { WorkDirLabel, workDirTitle, type WorkDirState } from './work-dir-label'
import { GroupedModelEffortSelector } from './model-selector/GroupedModelEffortSelector'
import { useCollabLaunchModelSelector } from './model-selector/useCollabLaunchModelSelector'
import { useRemoteAgentCatalogs, type RemoteAgentCatalog } from './model-selector/useRemoteAgentCatalogs'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { leaveDecisionField, shouldSuppressDecisionShortcut } from './composer-slot/decision-composer-policy'

interface Props {
  payload: SessionAgentRequestPayload
  onConfirm: (launches: SessionAgentLaunchProposal[]) => void
  /** The deny reason is handed back to the agent as the tool result. */
  onReject: (feedback?: string) => void
}

/**
 * The user may only retune *how* a proposed session runs — model, effort, AI provider and
 * permission mode. Everything else (which agent, the summary, cwd, worktree, sandbox) is the
 * requesting agent's decision and is rendered read-only.
 */
type EditableConfig = Pick<
  SessionAgentLaunchProposal['config'],
  'model' | 'effort' | 'fastMode' | 'apiProviderId' | 'permissionMode' | 'sandboxMode'
>

/** Idle harness glyph, brand-aware for ACP agents (e.g. Grok → acp-grok icon). */
function HarnessGlyph({
  profile,
  launch,
}: {
  profile: SessionAgentProfile | undefined
  /** Link launches have no agent profile — use peer harness fields instead. */
  launch?: SessionAgentLaunchProposal
}) {
  const Icon = resolveSessionIconFromBrandKey(profile?.brandKey ?? launch?.peerBrandKey)
    ?? resolveSessionIcon(
      profile?.harnessId ?? launch?.peerHarnessId,
      profile?.acpAgentId ?? launch?.peerAcpAgentId,
    )
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      {Icon
        ? <Icon status="default" renderLevel="compact" />
        : <Bot className="size-3 text-muted-foreground" />}
    </span>
  )
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
 * Where a child on another machine runs: the machine, its checkout or the
 * clone it will make, the branch base, and what of this checkout it will not see.
 */
function RemoteLaunchTarget({ remote }: { remote: SessionAgentRemoteLaunch }) {
  const { t } = useTranslation()
  const unseen = remote.unpushedCommits > 0 || remote.uncommittedChanges > 0
  return (
    <>
      <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <MetaChip icon={Server} label={remote.label} title={t('chat.sessionAgentsConfirm.remoteMachine', { machine: remote.label })} />
        {remote.projectPath ? (
          <MetaChip
            icon={FolderClosed}
            label={pathBasename(remote.projectPath)}
            title={`${t('chat.sessionAgentsConfirm.workingDirectory')}: ${remote.projectPath}`}
          />
        ) : (
          <MetaChip
            icon={FolderClosed}
            label={t('chat.sessionAgentsConfirm.remoteClone', { repository: remote.repository })}
            title={t('chat.sessionAgentsConfirm.remoteCloneInto', { url: remote.cloneUrl, directory: remote.cloneInto ?? '' })}
          />
        )}
        <MetaChip
          icon={GitBranch}
          label={remote.baseRef}
          title={t('chat.sessionAgentsConfirm.remoteBranchFrom', { ref: remote.baseRef })}
        />
      </div>
      {unseen && (
        <p className="mt-1 flex shrink-0 items-start gap-1 text-xs leading-snug text-warning">
          <AlertTriangle className="mt-px size-3 shrink-0" />
          <span>
            {t('chat.sessionAgentsConfirm.remoteUnseenChanges', {
              commits: remote.unpushedCommits,
              files: remote.uncommittedChanges,
            })}
          </span>
        </p>
      )}
    </>
  )
}

/** The target machine's own profile for a remote launch, once its catalog has loaded. */
function remoteProfileOf(launch: SessionAgentLaunchProposal, catalog: RemoteAgentCatalog | undefined): SessionAgentProfile | undefined {
  return catalog?.status === 'ready' ? catalog.profiles.find((profile) => profile.id === launch.agentId) : undefined
}

/**
 * The model control of a launch on another machine until its catalog offers
 * a picker: loading, a failed load with retry, or the target's default model
 * when it is too old to list one or lists no models for this agent.
 */
function RemoteModelStatus({
  remote,
  catalog,
  model,
  onRetry,
}: {
  remote: SessionAgentRemoteLaunch
  catalog: RemoteAgentCatalog | undefined
  model: string | undefined
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const machine = remote.label
  if (!catalog || catalog.status === 'loading') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 px-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate">{t('chat.sessionAgentsConfirm.remoteModelsLoading', { machine })}</span>
      </span>
    )
  }
  if (catalog.status === 'error') {
    return (
      <span className="inline-flex min-w-0 items-center gap-0.5 pl-1 text-xs text-error" title={catalog.message}>
        <AlertTriangle className="size-3 shrink-0" />
        <span className="truncate">{t('chat.sessionAgentsConfirm.remoteModelsError', { machine })}</span>
        <IconButton size="sm" tooltip={t('chat.sessionAgentsConfirm.remoteModelsRetry')} onClick={onRetry}>
          <RefreshCw />
        </IconButton>
      </span>
    )
  }
  return (
    <span
      className="min-w-0 truncate px-1 text-xs text-muted-foreground"
      title={t(
        catalog.status === 'unsupported' ? 'chat.sessionAgentsConfirm.remoteCatalogUnsupported' : 'chat.sessionAgentsConfirm.remoteNoModels',
        { machine },
      )}
    >
      {model
        ? t('chat.sessionAgentsConfirm.remoteModel', { model })
        : t('chat.sessionAgentsConfirm.remoteDefaultModel', { machine })}
    </span>
  )
}

function LaunchPanel({
  launch,
  requested,
  profile,
  remoteCatalog,
  onRetryRemoteCatalog,
  summaryExpanded,
  onToggleSummary,
  onChange,
}: {
  launch: SessionAgentLaunchProposal
  /** The launch as the agent proposed it, before the user's edits. */
  requested: SessionAgentLaunchProposal
  profile: SessionAgentProfile | undefined
  /** The target machine's catalog for a remote launch. */
  remoteCatalog: RemoteAgentCatalog | undefined
  onRetryRemoteCatalog: () => void
  summaryExpanded: boolean
  onToggleSummary: () => void
  onChange: (patch: EditableConfig) => void
}) {
  const { t } = useTranslation()
  const sandboxCapability = useAppStore((state) => state.sandboxCapability)
  const { config } = launch
  const link = isLinkLaunch(launch)
  const handoff = isHandoffLaunch(launch)
  const harnessId = profile?.harnessId ?? 'claude'
  // A remote launch picks from the target's own catalog, never this machine's.
  const remoteProfile = config.remote ? remoteProfileOf(launch, remoteCatalog) : undefined
  const catalogProfile = config.remote ? remoteProfile : profile
  const modelSelector = useCollabLaunchModelSelector({
    harnessId,
    profile: catalogProfile,
    catalog: config.remote ? 'profile' : 'local',
    apiProviderId: config.apiProviderId,
    selectedModelId: config.model ?? catalogProfile?.defaultConfig.model,
    selectedEffort: config.effort ?? catalogProfile?.defaultConfig.effort,
    onChange,
  })
  const workDirState: WorkDirState = launchWorkDir(config.worktree)
  const selectedProfileModel = profile?.models.find((model) => model.id === modelSelector.selectedModelId)
  const supportsFastMode = !config.remote && harnessId === 'codex' && !!findCodexFastServiceTier(selectedProfileModel)
  const remotePicker = !!remoteProfile && remoteProfile.models.length > 0
  const requestedModelMissing = !!remoteProfile && !isLaunchModelOffered(remoteProfile, requested.config)
  const nameRole = launchNameRoleLine(launch)
  const peerTitle = peerSessionTitle(launch)
  const summary = launch.summary.trim()
  const peerProject = launch.peerProjectPath ? pathBasename(launch.peerProjectPath) : null
  const sessionShort = shortSessionId(launch.sessionId)

  return (
    <div className="flex min-h-0 flex-col px-2.5 py-2">
      <div className="mb-1.5 flex min-w-0 shrink-0 items-center gap-1 text-xs font-medium text-foreground">
        {link ? (
          <>
            <span className="shrink-0 text-muted-foreground">{t('chat.sessionAgentsConfirm.workWith')}</span>
            {launch.sessionId ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openPeerSession(launch.sessionId!, launch.peerProjectPath)
                }}
                className="min-w-0 truncate text-left text-primary hover:underline"
                title={t('chat.sessionAgentsConfirm.openPeerSession')}
              >
                {peerTitle}
              </button>
            ) : (
              <span className="min-w-0 truncate">{peerTitle}</span>
            )}
          </>
        ) : (
          <>
            {handoff && (
              <span
                className="shrink-0 text-muted-foreground"
                title={t('chat.sessionAgentsConfirm.handOffHint')}
              >
                {t('chat.sessionAgentsConfirm.handOffTo')}
              </span>
            )}
            <span className="min-w-0 truncate">{nameRole}</span>
          </>
        )}
      </div>

      {/*
        The summary is what the user approves; the agent passes the full brief to
        session_collab_start. Collapsed it clamps to two lines; expanded it scrolls.
      */}
      <div
        className={cn(
          'min-h-0 transition-[max-height] duration-300 ease-out',
          summaryExpanded ? 'max-h-[min(50vh,calc(100dvh-14rem))] overflow-y-auto overscroll-contain' : 'max-h-12',
        )}
      >
        <button
          type="button"
          onClick={onToggleSummary}
          title={t(summaryExpanded ? 'chat.collaboration.collapseTask' : 'chat.collaboration.expandTask')}
          className="block w-full cursor-pointer text-left"
        >
          <span
            className={cn(
              'whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90',
              !summaryExpanded && 'line-clamp-2',
            )}
          >
            {summary}
          </span>
        </button>
      </div>

      {link ? (
        (sessionShort || peerProject) ? (
          <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            {sessionShort && (
              <MetaChip
                icon={MessageSquare}
                label={sessionShort}
                title={`${t('chat.sessionAgentsConfirm.peerSession')}: ${launch.sessionId}`}
              />
            )}
            {peerProject && (
              <MetaChip
                icon={FolderClosed}
                label={peerProject}
                title={
                  launch.peerProjectPath
                    ? `${t('chat.sessionAgentsConfirm.peerProject')}: ${launch.peerProjectPath}`
                    : peerProject
                }
              />
            )}
          </div>
        ) : null
      ) : (
        <>
          {config.remote ? <RemoteLaunchTarget remote={config.remote} /> : (
          <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            {config.cwd && (
              <MetaChip
                icon={FolderClosed}
                label={pathBasename(config.cwd)}
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
          )}

          <div className="mt-2 flex min-w-0 shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/20 px-1 py-0.5">
            {config.remote && !remotePicker ? (
              <RemoteModelStatus
                remote={config.remote}
                catalog={remoteCatalog}
                model={config.model}
                onRetry={onRetryRemoteCatalog}
              />
            ) : (<>
            {/* Fast mode rides in front of the model label as a toggleable glyph, mirroring the
                lightning bolt the chat-input model trigger shows when the Fast tier is on. */}
            {supportsFastMode && (
              <IconButton
                size="sm"
                tooltip={t('settings.preferences.fastMode.label')}
                aria-pressed={config.fastMode === true}
                onClick={() => onChange({ fastMode: config.fastMode !== true })}
              >
                {/* On/off reads as filled-vs-outline in the model label's own color — the same
                    contrast the chat-input trigger uses for its Fast bolt. */}
                <Zap className={cn(config.fastMode === true && 'fill-current')} />
              </IconButton>
            )}
            <GroupedModelEffortSelector
              models={modelSelector.models}
              modelGroups={modelSelector.modelGroups}
              selectedModelId={modelSelector.selectedModelId}
              selectedModelLabel={modelSelector.selectedModelLabel}
              onSelectModel={(modelId) => {
                modelSelector.onSelectModel(modelId)
                const nextModel = profile?.models.find((model) => model.id === modelId)
                if (harnessId === 'codex' && !findCodexFastServiceTier(nextModel)) {
                  onChange({ fastMode: false })
                }
              }}
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
            </>)}
            <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
            <HarnessPermissionPopover
              harnessId={harnessId}
              value={config.permissionMode ?? (harnessId === 'cursor' ? 'agent' : 'default')}
              onChange={(permissionMode: PermissionMode) => onChange({ permissionMode })}
            />
            {harnessSupportsSandbox(harnessId) && (
              <>
                <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
                <SandboxModePopover
                  value={coerceSandboxModeForHarness(harnessId, config.sandboxMode ?? 'off')}
                  onValueChange={(sandboxMode: SandboxMode) => onChange({ sandboxMode })}
                  supportLevel={harnessSandboxSupportLevel(harnessId, sandboxCapability?.supportLevel ?? 'always')}
                  availableModes={harnessSandboxModes(harnessId)}
                />
              </>
            )}
          </div>
          {config.remote && requestedModelMissing && (
            <p className="mt-1 flex shrink-0 items-start gap-1 text-xs leading-snug text-warning">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span>
                {t('chat.sessionAgentsConfirm.remoteModelUnavailable', {
                  model: requested.config.model,
                  machine: config.remote.label,
                })}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function SessionAgentsConfirmPrompt({ payload, onConfirm, onReject }: Props) {
  const { t } = useTranslation()
  const [overrides, setOverrides] = useState<Record<string, EditableConfig>>({})
  const [activeTab, setActiveTab] = useState(0)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const chatRootRef = useChatRootRef()

  const { launches, profiles } = payload
  const remoteEnvironmentIds = useMemo(
    () => launches.flatMap((launch) => (launch.config.remote ? [launch.config.remote.environmentId] : [])),
    [launches],
  )
  const { catalogs: remoteCatalogs, retry: retryRemoteCatalog } = useRemoteAgentCatalogs(remoteEnvironmentIds)
  const tabLabels = useMemo(() => buildLaunchTabLabels(launches, profiles), [launches, profiles])
  const multiple = launches.length > 1
  const activeIndex = Math.min(activeTab, launches.length - 1)
  const activeLaunch = launches[activeIndex]

  // Switching agents collapses the summary so a tall panel does not stick around.
  useEffect(() => {
    setSummaryExpanded(false)
  }, [activeIndex])

  const resolved = useMemo(
    () => launches.map((launch) => {
      if (launch.config.remote) {
        // Another machine: only its own catalog applies. Until it loads, or when the
        // machine cannot list one, the child runs on its defaults and only how it runs is editable.
        const { permissionMode, sandboxMode, fastMode: _fastMode, ...selection } = overrides[launch.launchId] ?? {}
        const remoteProfile = remoteProfileOf(launch, remoteCatalogs[launch.config.remote.environmentId])
        // A model the agent asked for that the target lacks falls back to the target's default.
        const fallback = remoteProfile && !isLaunchModelOffered(remoteProfile, launch.config)
          ? {
              model: remoteProfile.defaultConfig.model ?? remoteProfile.models[0]?.id,
              effort: remoteProfile.defaultConfig.effort,
            }
          : {}
        return {
          ...launch,
          config: {
            ...launch.config,
            ...(remoteProfile ? { ...fallback, ...selection } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(sandboxMode ? { sandboxMode } : {}),
          },
        }
      }
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
    [launches, overrides, profiles, remoteCatalogs],
  )

  const handleConfirm = useCallback(() => onConfirm(resolved), [onConfirm, resolved])
  const handleReject = useCallback(() => onReject(feedback.trim() || undefined), [onReject, feedback])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (shouldSuppressDecisionShortcut(event, chatRootRef?.current)) return
      if (hasOpenRadixOverlay()) return
      const typing = document.activeElement === feedbackRef.current

      // Tab walks the agent tabs and then the feedback field, so a single-agent prompt
      // behaves exactly like PermissionPrompt (Tab focuses the reason box).
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        if (typing) {
          leaveDecisionField(feedbackRef.current)
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
          leaveDecisionField(feedbackRef.current)
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
        if (summaryExpanded) {
          setSummaryExpanded(false)
          return
        }
        handleReject()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, launches.length, handleConfirm, handleReject, chatRootRef, summaryExpanded])

  if (!activeLaunch) return null

  return (
    <div
      className={cn(
        '@container mx-3 mb-1 flex flex-col overflow-hidden rounded-lg border border-primary/40 bg-card',
        // Cap the whole confirm card so an expanded summary never leaves the viewport.
        'max-h-[min(80vh,calc(100dvh-5rem))]',
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2">
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
      <div className={cn('mt-1.5 flex shrink-0 items-stretch gap-1 px-1.5', multiple && 'border-b border-border/50')}>
        <div role={multiple ? 'tablist' : undefined} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
        {launches.map((launch, index) => {
          const profile = profiles.find((item) => item.id === launch.agentId)
          const selected = index === activeIndex
          const body = (
            <>
              <HarnessGlyph profile={profile} launch={launch} />
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

      <div className="flex min-h-0 flex-col">
        <LaunchPanel
          key={activeLaunch.launchId}
          launch={resolved[activeIndex]}
          requested={activeLaunch}
          profile={profiles.find((profile) => profile.id === activeLaunch.agentId)}
          remoteCatalog={activeLaunch.config.remote ? remoteCatalogs[activeLaunch.config.remote.environmentId] : undefined}
          onRetryRemoteCatalog={() => {
            if (activeLaunch.config.remote) retryRemoteCatalog(activeLaunch.config.remote.environmentId)
          }}
          summaryExpanded={summaryExpanded}
          onToggleSummary={() => setSummaryExpanded((value) => !value)}
          onChange={(patch) => setOverrides((current) => ({
            ...current,
            [activeLaunch.launchId]: { ...current[activeLaunch.launchId], ...patch },
          }))}
        />
      </div>

      <div className="shrink-0 border-t border-border/50 px-2.5 py-2">
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
