import { useEffect, useMemo } from 'react'
import { createStore, useStore } from 'zustand'
import { LruMap } from '@superone/shared/lru-map'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { SessionAgentLaunchSettings } from '@superone/shared/agent-types'
import {
  suggestedTaskIdFromResult,
  type SuggestedTaskLaunchChoice,
  type SuggestedTaskLaunchOptions,
} from '@superone/shared/suggested-task'
import {
  SuggestedTaskCard,
  type SuggestedTaskActions,
  type SuggestedTaskCardProps,
} from '@superone/chat-view/presenters/SuggestedTaskCard'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import { useProjectHarnessCatalog } from '@/hooks/use-project-harness-catalog'
import { catalogEntryOn, catalogIdForSessionProvider, type HarnessCatalogStatus } from '@/lib/harness-visibility'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { callSession } from '@/lib/session-client'
import { connectionIdForProjectKey } from '@/lib/session-list-ops'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { LaunchAgentPicker, LaunchBarDivider, LaunchSettingsBar } from './launch-settings-bar'
import { renderToolMarkdown } from './tool-block-presenters/tool-markdown'

type Props = Omit<SuggestedTaskCardProps, 'actions' | 'unavailableReason' | 'launchControls' | 'renderMarkdown'> & { result?: string }

export type LaunchOptionsState =
  | { status: 'loading' }
  | { status: 'ready'; options: SuggestedTaskLaunchOptions }
  | { status: 'error'; message: string }

/**
 * A remote card may only offer harnesses that node advertises as enabled and
 * ready. `null` means the descriptor is not loaded yet, so the served list
 * stays on screen. This desktop's own card is not filtered here.
 */
export function offerSuggestedTaskProfiles(
  options: SuggestedTaskLaunchOptions,
  catalog: HarnessCatalogStatus[] | null,
): SuggestedTaskLaunchOptions {
  if (!catalog) return options
  const profiles = options.profiles.filter((profile) => {
    const id = catalogIdForSessionProvider(profile.harnessId, profile.acpAgentId)
    return id != null && catalogEntryOn(catalog, id)
  })
  if (profiles.length === options.profiles.length) return options
  if (profiles.length === 0 || profiles.some((profile) => profile.id === options.initial.agentId)) {
    return { ...options, profiles }
  }
  return { ...options, profiles, initial: { agentId: profiles[0]!.id, settings: {} } }
}

interface LaunchDraft {
  state: LaunchOptionsState
  fetching: boolean
  picked?: SuggestedTaskLaunchChoice
}

const initialDraft = (): LaunchDraft => ({ state: { status: 'loading' }, fetching: false })
const emptyDraft = createStore(initialDraft)

function createLaunchDraft(projectPath: string, sessionId: string, taskId: string) {
  const store = createStore(initialDraft)
  async function load(force = false) {
    const { state, fetching } = store.getState()
    if (fetching || (!force && state.status === 'ready')) return
    store.setState({ fetching: true, state: state.status === 'ready' ? state : { status: 'loading' } })
    try {
      const options = await callSession(projectPath, sessionId, 'session.suggestedTaskLaunchOptions',
        force ? { taskId, force } : { taskId })
      store.setState({ state: { status: 'ready', options }, fetching: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.setState({ state: state.status === 'ready' ? state : { status: 'error', message }, fetching: false })
    }
  }
  return { store, load }
}

// Keep pending cards across transcript remounts, including while their host is answering.
const launchDrafts = new LruMap<string, ReturnType<typeof createLaunchDraft>>(128)

/**
 * Agent, model and how the new session runs, once main has listed them.
 * Switching back to the suggesting session's agent restores its settings;
 * another agent starts on its own defaults.
 */
export function SuggestedTaskLaunchControls({
  state,
  choice,
  onChange,
  catalog = 'local',
  onRefreshModels,
  modelsLoading,
}: {
  state: LaunchOptionsState
  /** The user's pick; the options' initial one until they change it. */
  choice?: SuggestedTaskLaunchChoice
  onChange: (choice: SuggestedTaskLaunchChoice) => void
  catalog?: 'local' | 'profile'
  /** Re-probe a remote snapshot. A local catalog refreshes inside the launch control. */
  onRefreshModels?: () => void
  modelsLoading?: boolean
}) {
  const { t } = useTranslation()
  if (state.status === 'loading') return <Loader2 className="ml-1 size-3 animate-spin text-muted-foreground" />
  if (state.status === 'error') return <p className="truncate px-1 text-xs text-error" title={state.message}>{state.message}</p>
  if (state.options.profiles.length === 0) return <p className="truncate px-1 text-xs text-error">{t('chat.toolBlock.suggestedTask.unavailable')}</p>
  return <LaunchControls options={state.options} choice={choice ?? state.options.initial} onChange={onChange} catalog={catalog} onRefreshModels={onRefreshModels} modelsLoading={modelsLoading} />
}

function LaunchControls({
  options,
  choice,
  onChange,
  catalog,
  onRefreshModels,
  modelsLoading,
}: {
  options: SuggestedTaskLaunchOptions
  choice: SuggestedTaskLaunchChoice
  onChange: (choice: SuggestedTaskLaunchChoice) => void
  catalog: 'local' | 'profile'
  onRefreshModels?: () => void
  modelsLoading?: boolean
}) {
  const profile = options.profiles.find((item) => item.id === choice.agentId)
  const harnessId = profile?.harnessId ?? 'claude'
  const { LaunchModelControl } = HARNESS_CONTROLS[harnessId]
  const config = { ...profile?.defaultConfig, ...choice.settings }
  const patch = (settings: SessionAgentLaunchSettings) => onChange({ ...choice, settings: { ...choice.settings, ...settings } })
  return (
    <LaunchSettingsBar harnessId={harnessId} settings={config} onChange={patch} className="border-0 bg-transparent p-0">
      <LaunchAgentPicker
        profiles={options.profiles}
        value={choice.agentId}
        onChange={(agentId) => onChange({
          agentId,
          settings: agentId === options.initial.agentId ? options.initial.settings : {},
        })}
      />
      <LaunchBarDivider />
      <LaunchModelControl
        profile={profile}
        catalog={catalog}
        apiProviderId={config.apiProviderId}
        model={config.model}
        effort={config.effort}
        offerFastMode
        fastMode={config.fastMode}
        serviceTier={config.serviceTier}
        claudeFastMode={config.claudeFastMode}
        onRefreshModels={onRefreshModels}
        modelsLoading={modelsLoading}
        onChange={patch}
      />
    </LaunchSettingsBar>
  )
}

/** The card's source project selects its execution environment for reads and launch. */
export function SuggestedTaskToolBlock({ result, ...props }: Props) {
  const { t } = useTranslation()
  const scope = useSessionScope()
  const projectPath = useChatStore((state) => scope?.projectPath ?? state.activeProject)
  const sessionId = useChatStore((state) => (
    scope?.sessionId ?? (projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? null : null)
  ))
  const taskId = suggestedTaskIdFromResult(result)
  const pending = !props.state && !props.isStreaming && !props.isError && !props.isDenied && props.allowExpand !== false
  const sourceKey = projectPath && sessionId && taskId ? JSON.stringify([projectPath, sessionId, taskId]) : null
  const draft = useMemo(() => {
    if (!pending || !sourceKey || !projectPath || !sessionId || !taskId) return null
    const existing = launchDrafts.get(sourceKey)
    if (existing) return existing
    const created = createLaunchDraft(projectPath, sessionId, taskId)
    launchDrafts.set(sourceKey, created)
    return created
  }, [pending, sourceKey, projectPath, sessionId, taskId])
  const { state, fetching, picked } = useStore(draft?.store ?? emptyDraft)
  useEffect(() => { void draft?.load() }, [draft])
  useEffect(() => {
    if (props.state && sourceKey) launchDrafts.delete(sourceKey)
  }, [props.state, sourceKey])
  const remote = Boolean(projectPath && connectionIdForProjectKey(projectPath) !== 'local')
  const hostCatalog = useProjectHarnessCatalog(useAppStore((state) => state.harnessCatalog))
  const catalog = remote ? 'profile' : 'local'
  const shownState = state.status === 'ready'
    ? { status: 'ready' as const, options: offerSuggestedTaskProfiles(state.options, remote ? hostCatalog : null) }
    : state
  const readyProfiles = shownState.status === 'ready' ? shownState.options.profiles : null
  const validPick = picked && readyProfiles?.some((profile) => profile.id === picked.agentId) ? picked : undefined
  const servedInitial = shownState.status === 'ready' ? shownState.options.initial : undefined
  const choice = validPick
    ?? (servedInitial && readyProfiles?.some((profile) => profile.id === servedInitial.agentId) ? servedInitial : undefined)

  const actions = useMemo<SuggestedTaskActions | undefined>(() => {
    if (!projectPath || !sessionId || !taskId) return undefined
    return {
      launch: async () => {
        await callSession(projectPath, sessionId, 'session.launchSuggestedTask', { taskId, choice })
      },
    }
  }, [projectPath, sessionId, taskId, choice])

  return (
    <SuggestedTaskCard
      {...props}
      actions={actions}
      unavailableReason={t('chat.toolBlock.suggestedTask.unavailable')}
      launchControls={draft && (
        <SuggestedTaskLaunchControls
          state={shownState}
          choice={validPick}
          onChange={(picked) => draft.store.setState({ picked })}
          catalog={catalog}
          onRefreshModels={remote ? () => { void draft.load(true) } : undefined}
          modelsLoading={remote ? fetching : undefined}
        />
      )}
      renderMarkdown={renderToolMarkdown}
    />
  )
}
