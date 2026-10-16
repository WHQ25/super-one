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

/** The launch pickers of a pending card, loaded from main; null while there is nothing to launch. */
function useLaunchOptions(target: { projectPath: string; sessionId: string; taskId: string } | null): LaunchOptionsState | null {
  const [state, setState] = useState<{ key: string; value: LaunchOptionsState } | null>(null)
  const sessionId = target?.sessionId
  const taskId = target?.taskId
  const projectPath = target?.projectPath
  const key = JSON.stringify([projectPath, sessionId, taskId])
  useEffect(() => {
    if (!projectPath || !sessionId || !taskId) {
      setState(null)
      return
    }
    let cancelled = false
    setState({ key, value: { status: 'loading' } })
    callSession(projectPath, sessionId, 'session.suggestedTaskLaunchOptions', { taskId }).then(
      (options) => {
        if (!cancelled) setState({ key, value: { status: 'ready', options } })
      },
      (error: unknown) => {
        if (!cancelled) setState({ key, value: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
      },
    )
    return () => { cancelled = true }
  }, [projectPath, sessionId, taskId])
  return target ? state?.key === key ? state.value : { status: 'loading' } : null
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
}: {
  state: LaunchOptionsState
  /** The user's pick; the options' initial one until they change it. */
  choice?: SuggestedTaskLaunchChoice
  onChange: (choice: SuggestedTaskLaunchChoice) => void
  catalog?: 'local' | 'profile'
}) {
  if (state.status === 'loading') return <Loader2 className="ml-1 size-3 animate-spin text-muted-foreground" />
  if (state.status === 'error') return <p className="truncate px-1 text-xs text-error" title={state.message}>{state.message}</p>
  return <LaunchControls options={state.options} choice={choice ?? state.options.initial} onChange={onChange} catalog={catalog} />
}

function LaunchControls({
  options,
  choice,
  onChange,
  catalog,
}: {
  options: SuggestedTaskLaunchOptions
  choice: SuggestedTaskLaunchChoice
  onChange: (choice: SuggestedTaskLaunchChoice) => void
  catalog: 'local' | 'profile'
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
        claudeFastMode={config.claudeFastMode}
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
  const sourceKey = JSON.stringify([projectPath, sessionId, taskId])
  const [selection, setSelection] = useState<{ source: string; choice: SuggestedTaskLaunchChoice }>()
  const picked = selection?.source === sourceKey ? selection.choice : undefined
  const setPicked = (choice: SuggestedTaskLaunchChoice) => setSelection({ source: sourceKey, choice })
  const choice = picked ?? (launchOptions?.status === 'ready' ? launchOptions.options.initial : undefined)

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
      launchControls={launchOptions ? <SuggestedTaskLaunchControls state={launchOptions} choice={picked} onChange={setPicked}
        catalog={projectPath && connectionIdForProjectKey(projectPath) !== 'local' ? 'profile' : 'local'} /> : undefined}
      renderMarkdown={renderToolMarkdown}
    />
  )
}
