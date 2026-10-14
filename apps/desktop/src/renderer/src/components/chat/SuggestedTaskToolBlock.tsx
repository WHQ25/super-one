import { useEffect, useMemo, useState } from 'react'
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
import { isRemoteSession, useChatStore } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { LaunchAgentPicker, LaunchBarDivider, LaunchSettingsBar } from './launch-settings-bar'
import { renderToolMarkdown } from './tool-block-presenters/tool-markdown'

type Props = Omit<SuggestedTaskCardProps, 'actions' | 'unavailableReason' | 'launchControls' | 'renderMarkdown'> & { result?: string }

export type LaunchOptionsState =
  | { status: 'loading' }
  | { status: 'ready'; options: SuggestedTaskLaunchOptions }
  | { status: 'error'; message: string }

/** The launch pickers of a pending card, loaded from main; null while there is nothing to launch. */
function useLaunchOptions(target: { sessionId: string; taskId: string } | null): LaunchOptionsState | null {
  const [state, setState] = useState<LaunchOptionsState | null>(null)
  const sessionId = target?.sessionId
  const taskId = target?.taskId
  useEffect(() => {
    if (!sessionId || !taskId) {
      setState(null)
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    window.agent.suggestedTaskLaunchOptions(sessionId, taskId).then(
      (reply) => {
        if (!cancelled) setState(reply.ok ? { status: 'ready', options: reply } : { status: 'error', message: reply.error })
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { cancelled = true }
  }, [sessionId, taskId])
  return state
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
}: {
  state: LaunchOptionsState
  /** The user's pick; the options' initial one until they change it. */
  choice?: SuggestedTaskLaunchChoice
  onChange: (choice: SuggestedTaskLaunchChoice) => void
}) {
  if (state.status === 'loading') return <Loader2 className="ml-1 size-3 animate-spin text-muted-foreground" />
  if (state.status === 'error') return <p className="truncate px-1 text-xs text-error" title={state.message}>{state.message}</p>
  return <LaunchControls options={state.options} choice={choice ?? state.options.initial} onChange={onChange} />
}

function LaunchControls({
  options,
  choice,
  onChange,
}: {
  options: SuggestedTaskLaunchOptions
  choice: SuggestedTaskLaunchChoice
  onChange: (choice: SuggestedTaskLaunchChoice) => void
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
        catalog="local"
        apiProviderId={config.apiProviderId}
        model={config.model}
        effort={config.effort}
        offerFastMode
        fastMode={config.fastMode}
        onChange={patch}
      />
    </LaunchSettingsBar>
  )
}

/** Desktop host adapter: launching runs in main, for this pane's local session only. */
export function SuggestedTaskToolBlock({ result, ...props }: Props) {
  const { t } = useTranslation()
  const scope = useSessionScope()
  const projectPath = useChatStore((state) => scope?.projectPath ?? state.activeProject)
  const sessionId = useChatStore((state) => (
    scope?.sessionId ?? (projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? null : null)
  ))
  const local = useChatStore((state) => Boolean(projectPath && sessionId && !isRemoteSession(state, projectPath, sessionId)))
  const taskId = suggestedTaskIdFromResult(result)
  const pending = !props.state && !props.isStreaming && !props.isError && !props.isDenied && props.allowExpand !== false
  const target = useMemo(
    () => (pending && local && sessionId && taskId ? { sessionId, taskId } : null),
    [pending, local, sessionId, taskId],
  )
  const launchOptions = useLaunchOptions(target)
  const [picked, setPicked] = useState<SuggestedTaskLaunchChoice>()
  const choice = picked ?? (launchOptions?.status === 'ready' ? launchOptions.options.initial : undefined)

  const actions = useMemo<SuggestedTaskActions | undefined>(() => {
    if (!local || !sessionId || !taskId) return undefined
    return {
      launch: async () => {
        const reply = await window.agent.launchSuggestedTask(sessionId, taskId, choice)
        return reply.ok ? undefined : reply.error
      },
    }
  }, [local, sessionId, taskId, choice])

  return (
    <SuggestedTaskCard
      {...props}
      actions={actions}
      unavailableReason={t('chat.toolBlock.suggestedTask.unavailable')}
      launchControls={launchOptions ? <SuggestedTaskLaunchControls state={launchOptions} choice={picked} onChange={setPicked} /> : undefined}
      renderMarkdown={renderToolMarkdown}
    />
  )
}
