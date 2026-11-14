import { useCallback, useState } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronsDown } from 'lucide-react'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import type { ChatMessage, ContentBlock, HarnessId } from '@superone/shared/agent-types'
import { servesMethod } from '@superone/shared/environment/capabilities'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { subagentRunState } from '@superone/chat-view/presenters/subagent-run-state'
import { cn } from '@superone/ui/lib/utils'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'
import { getCachedEnvironmentItems } from '@/lib/environment-list'
import { callSession } from '@/lib/session-client'
import { useAppStore } from '@/stores/app'
import { useActiveSession, useChatStore, type SessionScope } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { parseToolInput } from './tool-display'
import {
  isSubagentToolName,
  looksLikeBackgroundSubagentAck,
  parseSubagentIdFromText,
  parseTaskInput,
  resolveTaskProgressEntry,
} from './subagent-utils'

export interface BackgroundTaskSessionSnapshot {
  messages?: ChatMessage[]
  status?: string
  sessionProvider?: HarnessId | null
  preferredProvider?: HarnessId | null
  taskProgress?: Record<string, { taskId?: string; completed?: boolean; status?: string }>
  pendingPermissions?: Array<{ toolUseId?: string }>
}

export function canEnvironmentServeSync(projectPath: string | null | undefined, method: string): boolean {
  const connectionId = projectPath ? parseRemoteProjectKey(projectPath)?.connectionId ?? null : null
  if (!connectionId) return true
  const capabilities = getCachedEnvironmentItems()?.find((item) => item.connectionId === connectionId)?.capabilities
  return capabilities ? servesMethod(capabilities, method) : true
}

export function hasForegroundBackgroundableTask(
  session: BackgroundTaskSessionSnapshot | null | undefined,
  bashOutputs: Record<string, { finished?: boolean } | undefined> = {},
): boolean {
  if (!session?.messages?.length) return false
  const messages = session.messages

  const results = new Map<string, ContentBlock & { type: 'tool_result' }>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result' && block.toolUseId) {
        results.set(block.toolUseId, block)
      }
    }
  }

  const pendingIds = new Set(
    (session.pendingPermissions ?? [])
      .map((permission) => permission.toolUseId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  const taskProgress = session.taskProgress ?? {}
  const sessionStreaming = session.status === 'streaming'

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_use' || !block.toolUseId) continue
      if (pendingIds.has(block.toolUseId)) continue

      if (block.toolName === 'Bash') {
        const params = parseToolInput(block.input, 'Bash')
        const alreadyBackgrounded = params.run_in_background === true || params.background === true || block.runInBackground === true
        if (alreadyBackgrounded) continue
        const liveOutput = bashOutputs[block.toolUseId]
        const isLiveRunning = !!liveOutput && !liveOutput.finished
        const hasResult = results.has(block.toolUseId)
        if ((sessionStreaming && block.status === 'streaming' && !hasResult) || isLiveRunning) {
          return true
        }
        continue
      }

      if (isSubagentToolName(block.toolName)) {
        const resultBlock = results.get(block.toolUseId)
        const rawResultText = resultBlock?.summary
        const taskInput = parseTaskInput(block.input)
        const isAsync = taskInput.runInBackground || !!block.runInBackground || looksLikeBackgroundSubagentAck(rawResultText)
        if (isAsync) continue
        const taskIdHint = parseSubagentIdFromText(rawResultText) ?? parseSubagentIdFromText(block.taskResultText)
        const progress = resolveTaskProgressEntry(taskProgress, block.toolUseId, taskIdHint)
        const { isRunning } = subagentRunState({
          tracked: !!progress || isAsync,
          finished: progress ? !!progress.completed : !!block.taskStatus || !!block.taskResultText,
          hasResult: !!resultBlock,
          isStreaming: sessionStreaming,
        })
        if (isRunning) return true
      }
    }
  }

  return false
}

export function runBackgroundTasksRequest(
  projectPath: string,
  sessionId: string,
  toolUseId?: string,
): Promise<boolean> {
  return callSession(projectPath, sessionId, 'session.backgroundTasks', toolUseId ? { toolUseId } : {}).catch((err) => {
    const message = i18n.t('chat.toolBlock.backgroundTaskFailed')
    toast.error(err instanceof Error && err.message ? `${message}: ${err.message}` : message)
    return false
  })
}

export function triggerBackgroundTasksShortcut(scope?: SessionScope): boolean {
  if (useAppStore.getState().view !== 'main') return false
  const state = useChatStore.getState()
  const projectPath = scope?.projectPath ?? state.activeProject ?? null
  const project = projectPath ? state.projectSessions?.[projectPath] : undefined
  const sessionId = scope?.sessionId ?? project?._activeSessionId ?? null
  const session = sessionId ? project?._sessions?.[sessionId] : undefined
  if (!projectPath || !sessionId || !session) return false

  const provider = session.sessionProvider ?? session.preferredProvider ?? null
  if (!provider || !HARNESS_CAPABILITIES[provider]?.supportsTaskBackground) return false
  if (!canEnvironmentServeSync(projectPath, 'session.backgroundTasks')) return false
  if (!hasForegroundBackgroundableTask(session, state._bashOutputs)) return false

  void runBackgroundTasksRequest(projectPath, sessionId)
  return true
}

export function BackgroundTaskActionButton({ toolUseId }: { toolUseId: string }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const harness = useActiveSession((s) => s.sessionProvider ?? s.preferredProvider ?? 'claude')
  const scope = useSessionScope()
  const activeProject = useChatStore((s) => s.activeProject ?? null)
  const projectPath = scope?.projectPath ?? activeProject
  const scopedSessionId = useChatStore((s) => (projectPath ? s.projectSessions?.[projectPath]?._activeSessionId : undefined) ?? null)
  const sessionId = scope?.sessionId ?? scopedSessionId
  const servesBackgroundTasks = useEnvironmentServes(projectPath, 'session.backgroundTasks')

  const trigger = useCallback(() => {
    if (!projectPath || !sessionId || !toolUseId || pending) return
    setPending(true)
    void runBackgroundTasksRequest(projectPath, sessionId, toolUseId).finally(() => {
      setPending(false)
    })
  }, [pending, projectPath, sessionId, toolUseId])

  if (!toolUseId || !HARNESS_CAPABILITIES[harness]?.supportsTaskBackground || !servesBackgroundTasks) {
    return null
  }

  const label = t('chat.toolBlock.runInBackgroundShortcut')

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-disabled={pending || undefined}
            data-background-task-trigger={toolUseId}
            onClick={(event) => {
              event.stopPropagation()
              trigger()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                trigger()
              }
            }}
            className={cn(
              'inline-flex items-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              pending && 'pointer-events-none opacity-50',
            )}
          >
            <ChevronsDown className="size-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          <span>{t('chat.toolBlock.runInBackground')}</span> <CommandShortcut>Ctrl+B</CommandShortcut>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
