import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useChatStore } from '@/stores/chat'
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

function launchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The launch pickers of a pending card, loaded from main; null while there is nothing to launch. */
function useLaunchOptions(target: { projectPath: string; sessionId: string; taskId: string } | null): {
  state: LaunchOptionsState | null
  refresh: () => void
  refreshing: boolean
} {
  const [state, setState] = useState<{ key: string; value: LaunchOptionsState } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const sessionId = target?.sessionId
  const taskId = target?.taskId
  const projectPath = target?.projectPath
  const key = JSON.stringify([projectPath, sessionId, taskId])
  const request = useRef(0)
  useEffect(() => {
    if (!projectPath || !sessionId || !taskId) {
      setState(null)
      setRefreshing(false)
      return
    }
    const token = ++request.current
    let cancelled = false
    setState({ key, value: { status: 'loading' } })
    setRefreshing(false)
    callSession(projectPath, sessionId, 'session.suggestedTaskLaunchOptions', { taskId }).then(
      (options) => {
        if (!cancelled && request.current === token) setState({ key, value: { status: 'ready', options } })
      },
      (error: unknown) => {
        if (!cancelled && request.current === token) setState({ key, value: { status: 'error', message: launchErrorMessage(error) } })
      },
    )
    return () => {
      cancelled = true
      request.current += 1
    }
  }, [projectPath, sessionId, taskId])
  const refresh = useCallback(() => {
    if (!projectPath || !sessionId || !taskId) return
    const token = ++request.current
    const refreshKey = key
    setRefreshing(true)
    callSession(projectPath, sessionId, 'session.suggestedTaskLaunchOptions', { taskId, force: true }).then(
      (options) => {
        if (request.current !== token) return
        setState({ key: refreshKey, value: { status: 'ready', options } })
      },
      (error: unknown) => {
        if (request.current !== token) return
        setState((current) => (
          current?.key === refreshKey && current.value.status === 'ready'
            ? current
            : { key: refreshKey, value: { status: 'error', message: launchErrorMessage(error) } }
        ))
      },
    ).finally(() => {
      if (request.current === token) setRefreshing(false)
    })
  }, [projectPath, sessionId, taskId, key])
  return {
    state: target ? state?.key === key ? state.value : { status: 'loading' } : null,
    refresh,
    refreshing: target ? refreshing : false,
  }
}

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
  if (state.status === 'loading') return <Loader2 className="ml-1 size-3 animate-spin text-muted-foreground" />
  if (state.status === 'error') return <p className="truncate px-1 text-xs text-error" title={state.message}>{state.message}</p>
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
  const target = useMemo(
    () => (pending && projectPath && sessionId && taskId ? { projectPath, sessionId, taskId } : null),
    [pending, projectPath, sessionId, taskId],
  )
  const launchOptions = useLaunchOptions(target)
  const catalog = projectPath && connectionIdForProjectKey(projectPath) !== 'local' ? 'profile' : 'local'
  const sourceKey = JSON.stringify([projectPath, sessionId, taskId])
  const [selection, setSelection] = useState<{ source: string; choice: SuggestedTaskLaunchChoice }>()
  const picked = selection?.source === sourceKey ? selection.choice : undefined
  const setPicked = (choice: SuggestedTaskLaunchChoice) => setSelection({ source: sourceKey, choice })
  const choice = picked ?? (launchOptions.state?.status === 'ready' ? launchOptions.state.options.initial : undefined)

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
      launchControls={launchOptions.state ? <SuggestedTaskLaunchControls state={launchOptions.state} choice={picked} onChange={setPicked}
        catalog={catalog}
        onRefreshModels={catalog === 'profile' ? launchOptions.refresh : undefined}
        modelsLoading={catalog === 'profile' ? launchOptions.refreshing : undefined} /> : undefined}
      renderMarkdown={renderToolMarkdown}
    />
  )
}
