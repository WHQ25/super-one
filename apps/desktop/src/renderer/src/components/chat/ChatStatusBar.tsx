import { callSession } from '@/lib/session-client'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'
import { StatusBarMailbox } from './chat-status-bar/StatusBarMailbox'
import { StatusBarSchedules } from './chat-status-bar/StatusBarSchedules'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Activity, ChevronDown, Square, SquareTerminal, Bot, Workflow, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useActiveSession, useChatStore, useSessionScope, getActiveSessionView } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { StatusBarPermission } from './chat-status-bar/StatusBarPermission'
import { StatusBarSandbox } from './chat-status-bar/StatusBarSandbox'
import { StatusBarPip, useHiddenPipTarget } from './chat-status-bar/StatusBarPip'
import { WorkDirIndicator } from './WorkDirIndicator'
import { useComposerLocation } from './composer-location'
import { useOnTurnCompleted } from '@/hooks/useOnTurnCompleted'
import { parseToolInput } from './tool-display'
import { ToolBlock } from './ToolBlock'
import { SubagentBlock } from './SubagentBlock'
import {
  collectSubagentSubtree,
  isSubagentToolName,
  looksLikeBackgroundSubagentAck,
  parseSubagentIdFromText,
  parseTaskInput,
  resolveTaskProgressEntry,
} from './subagent-utils'
import { isWorkflowSmokeCheck, parseWorkflowInput, parseWorkflowLaunch, workflowToolTargetLabel } from './workflow-utils'
import { WorkflowBlock } from './WorkflowBlock'
import type { ContentBlock, GitInfo, GitInfoResult } from '@superone/shared/agent-types'

interface WorktreeStateLike {
  pendingBaseBranch: string | null
  activePath: string | null
}

export function computeIsInWorktree(wtState: WorktreeStateLike | undefined): boolean {
  return !!(wtState?.pendingBaseBranch || wtState?.activePath)
}

export type BackgroundActivityItem =
  | {
      id: string
      kind: 'bash'
      title: string
      toolUse: ContentBlock & { type: 'tool_use' }
      result?: ContentBlock & { type: 'tool_result' }
    }
  | {
      id: string
      kind: 'agent'
      title: string
      taskBlock: ContentBlock & { type: 'tool_use' }
      childBlocks: ContentBlock[]
      resultBlock?: ContentBlock & { type: 'tool_result' }
    }
  | {
      id: string
      kind: 'workflow'
      title: string
      toolBlock: ContentBlock & { type: 'tool_use' }
      resultBlock?: ContentBlock & { type: 'tool_result' }
    }
  | {
      id: string
      kind: 'monitor'
      title: string
      toolUse: ContentBlock & { type: 'tool_use' }
      result?: ContentBlock & { type: 'tool_result' }
    }

type TaskProgress = Record<string, {
  description: string
  taskId?: string
  completed?: boolean
  [k: string]: unknown
}>

export function computeBackgroundActivitySignature(messages: Array<{ content: ContentBlock[] }>): string {
  let blockCount = 0
  const completedSubagentIds: string[] = []
  for (const message of messages) {
    blockCount += message.content.length
    for (const block of message.content) {
      if (block.type === 'tool_use' && isSubagentToolName(block.toolName) && block.taskResultText) {
        completedSubagentIds.push(block.toolUseId)
      }
    }
  }
  return JSON.stringify([messages.length, blockCount, completedSubagentIds])
}

export function collectBackgroundActivities(
  messages: Array<{ content: ContentBlock[] }>,
  taskProgress: TaskProgress,
  isStreaming: boolean = false,
): {
  bashActivities: Extract<BackgroundActivityItem, { kind: 'bash' }>[]
  agentActivities: Extract<BackgroundActivityItem, { kind: 'agent' }>[]
  workflowActivities: Extract<BackgroundActivityItem, { kind: 'workflow' }>[]
  monitorActivities: Extract<BackgroundActivityItem, { kind: 'monitor' }>[]
} {
  const results = new Map<string, ContentBlock & { type: 'tool_result' }>()
  const bashActivities: Extract<BackgroundActivityItem, { kind: 'bash' }>[] = []
  const agentActivities: Extract<BackgroundActivityItem, { kind: 'agent' }>[] = []
  const workflowActivities: Extract<BackgroundActivityItem, { kind: 'workflow' }>[] = []
  const monitorActivities: Extract<BackgroundActivityItem, { kind: 'monitor' }>[] = []

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        results.set(block.toolUseId, block)
      }
    }
  }

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue

      if (block.toolName === 'Monitor') {
        const params = parseToolInput(block.input, block.toolName)
        const result = results.get(block.toolUseId)
        const progress = taskProgress[block.toolUseId]
        // taskProgress is authoritative after task_started. A result without it
        // is a reloaded historical monitor, not a live watch.
        const isRunning = progress
          ? progress.completed !== true
          : !result && (block.status === 'streaming' || isStreaming)
        if (!isRunning) continue
        const description = typeof params.description === 'string' ? params.description.trim() : ''
        const command = typeof params.command === 'string' ? params.command.trim() : ''
        monitorActivities.push({
          id: block.toolUseId,
          kind: 'monitor',
          title: description || command || 'Monitor',
          toolUse: block,
          result,
        })
        continue
      }

      if (block.toolName === 'Bash') {
        const params = parseToolInput(block.input, block.toolName)
        const result = results.get(block.toolUseId)
        const progress = taskProgress[block.toolUseId]
        const runInBackground = params.run_in_background === true || params.background === true
        const hasTaskState = !!progress
        const isStreamingTool = block.status === 'streaming'
        const hasBackgroundSignal = runInBackground || !!result?.outputPath
        const isRunning = hasTaskState ? progress.completed !== true : (runInBackground && isStreamingTool)
        if (!hasBackgroundSignal || !isRunning) continue

        const command = typeof params.command === 'string' ? params.command.trim() : ''
        bashActivities.push({
          id: block.toolUseId,
          kind: 'bash',
          title: command || 'Bash',
          toolUse: block,
          result,
        })
        continue
      }

      if (isSubagentToolName(block.toolName)) {
        const taskInput = parseTaskInput(block.input)
        const isAsync = taskInput.runInBackground
        const resultBlock = results.get(block.toolUseId)
        const resultSummary = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
        const taskIdHint = parseSubagentIdFromText(resultSummary) ?? parseSubagentIdFromText(block.taskResultText)
        // Prefer toolUseId key; fall back to provisional Grok subagent_id key.
        const progress = resolveTaskProgressEntry(taskProgress, block.toolUseId, taskIdHint)
        // taskProgress is the authoritative running signal: every sub-agent (top-level,
        // nested, background or foreground) emits task_started→task_notification, so a
        // background agent stays "running" after its early tool_result and a nested
        // agent stays "running" while the main turn is idle. Agents without task
        // tracking fall back to: no result yet AND (async hint OR turn still streaming).
        // Grok spawn often returns an early plain-text ack without run_in_background —
        // treat that as async (like SubagentBlock): still running until taskResultText
        // (from task_notification) arrives, not forever via the ack alone.
        const looksLikeBgAck = looksLikeBackgroundSubagentAck(resultSummary)
        const isRunning = progress
          ? progress.completed !== true
          : looksLikeBgAck
            ? !block.taskResultText
            : (!resultBlock && (isAsync || isStreaming))
        if (!isRunning) continue
        const childBlocks = collectSubagentSubtree(message.content, block.toolUseId)
        const title = (taskInput.description || taskInput.name || taskInput.subagentType || 'Agent').trim() || 'Agent'
        agentActivities.push({
          id: block.toolUseId,
          kind: 'agent',
          title,
          taskBlock: block,
          childBlocks,
          resultBlock,
        })
        continue
      }

      // Workflow launches return early (run_id) and keep running via taskProgress —
      // same background surface as bash / agents.
      if (block.toolName === 'Workflow') {
        if (isWorkflowSmokeCheck(block.input)) continue
        const resultBlock = results.get(block.toolUseId)
        const launch = parseWorkflowLaunch(
          resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined,
        )
        const runKey = launch.runId ?? launch.taskId
        const progress = resolveTaskProgressEntry(taskProgress, block.toolUseId, runKey)
        // Authoritative while tracked; otherwise only treat as running during the
        // launch window (streaming / no result yet). Idle + result without progress
        // is a historical complete (reload).
        const isRunning = progress
          ? progress.completed !== true
          : (!resultBlock && isStreaming) || (isStreaming && !!runKey && !block.taskResultText)
        if (!isRunning) continue
        const meta = parseWorkflowInput(block.input)
        const title =
          meta.name
          || block.workflowName
          || launch.name
          || workflowToolTargetLabel(block.input)
          || 'Workflow'
        workflowActivities.push({
          id: block.toolUseId,
          kind: 'workflow',
          title,
          toolBlock: block,
          resultBlock,
        })
      }
    }
  }

  return { bashActivities, agentActivities, workflowActivities, monitorActivities }
}

export function ChatStatusBar() {
  const { t } = useTranslation()
  const barRef = useRef<HTMLDivElement>(null)
  const fullModeRequiredWidthRef = useRef(0)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const location = useComposerLocation()
  const gitFolder = location.cwd || currentFolder
  const scope = useSessionScope()
  // Track structural changes plus subagent result arrival without subscribing to text deltas.
  const activitySignature = useActiveSession((s) => computeBackgroundActivitySignature(s.messages))
  const sessionStatus = useActiveSession((s) => s.status)
  const taskProgress = useActiveSession((s) => s.taskProgress)
  const sessionSchedules = useActiveSession((s) => s.sessionSchedules)
  const activeSessionId = useActiveSession((s) => scope?.sessionId ?? s._activeSessionId)
  const hiddenPipTarget = useHiddenPipTarget(activeSessionId)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const activeProvider = sessionProvider ?? preferredProvider
  const [compactIndicators, setCompactIndicators] = useState(false)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [bashOpen, setBashOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [monitorOpen, setMonitorOpen] = useState(false)

  // One RPC path: getGitInfo implies isRepo; skip separate getGitIsRepo (was 2× remote status).
  // `null` = not a repo (offer init); `branch: null` = git itself failed, so the
  // repo question stays open (`isGitRepo` unknown) and the reason is shown instead.
  const applyGitInfo = useCallback((info: GitInfoResult) => {
    if (info?.branch == null) {
      setIsGitRepo(info ? null : false)
      setGitError(info?.error ?? null)
      return
    }
    setGitInfo(info)
    setIsGitRepo(true)
    setGitError(null)
  }, [])

  const refreshGitInfo = useCallback(async () => {
    if (!gitFolder) return
    applyGitInfo(await window.app.getGitInfo(gitFolder))
  }, [gitFolder, applyGitInfo])

  // Initial read for the project. Everything after this is event-driven — git
  // state only changes when someone acts on the repo, and every actor that can
  // do so already gives us a signal.
  useEffect(() => {
    if (!gitFolder) { setGitInfo(null); setIsGitRepo(null); setGitError(null); return }

    let cancelled = false
    // Optimistic: assume git repo until proven otherwise so Local chip paints immediately.
    setIsGitRepo(true)
    window.app.getGitInfo(gitFolder).then((info) => {
      if (cancelled) return
      if (info?.branch == null) setGitInfo(null)
      applyGitInfo(info)
    }).catch(() => {
      if (!cancelled) setIsGitRepo(false)
    })
    return () => { cancelled = true }
  }, [gitFolder, applyGitInfo])

  useOnTurnCompleted(refreshGitInfo)

  useEffect(() => {
    const unsub = window.app.onGitHeadChange(() => refreshGitInfo())
    return unsub
  }, [refreshGitInfo])

  const updateCompactState = useCallback(() => {
    const node = barRef.current
    if (!node) return
    const availableWidth = node.clientWidth

    if (!compactIndicators) {
      const requiredWidth = node.scrollWidth
      fullModeRequiredWidthRef.current = requiredWidth
      if (requiredWidth > availableWidth + 1) {
        setCompactIndicators(true)
      }
      return
    }

    if (availableWidth >= fullModeRequiredWidthRef.current + 1) {
      setCompactIndicators(false)
    }
  }, [compactIndicators])

  useEffect(() => {
    const node = barRef.current
    if (!node) return
    let rafId = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateCompactState)
    })
    observer.observe(node)
    return () => { cancelAnimationFrame(rafId); observer.disconnect() }
  }, [updateCompactState])

  useEffect(() => {
    updateCompactState()
  }, [
    updateCompactState,
    gitInfo?.branch,
    activeProvider,
    location.cwd,
    location.selection.kind,
    isGitRepo,
  ])

  const { bashActivities, agentActivities, workflowActivities, monitorActivities } = useMemo(
    () => collectBackgroundActivities(getActiveSessionView(scope).messages, taskProgress, sessionStatus === 'streaming'),
    // messages is read non-reactively; recompute is driven by the cheap signature + task/status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activitySignature, taskProgress, sessionStatus, scope],
  )

  const sessionProject = scope?.projectPath ?? useChatStore((s) => s.activeProject)
  const canStopTask = useEnvironmentServes(sessionProject, 'session.stopTask')
  const handleStopTask = useCallback((taskId: string) => {
    if (!activeSessionId || !sessionProject || !canStopTask) return
    void callSession(sessionProject, activeSessionId, 'session.stopTask', { taskId }).catch((err) => {
      toast.error(`Failed to stop task: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, [sessionProject, activeSessionId, canStopTask])
  const renderStopButton = useCallback((taskId: string) => canStopTask ? (
    <span
      role="button"
      tabIndex={0}
      title="Stop task"
      onClick={(e) => { e.stopPropagation(); handleStopTask(taskId) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleStopTask(taskId) } }}
      className="inline-flex items-center rounded p-0.5 text-destructive hover:bg-destructive/20"
    >
      <Square className="size-2.5 fill-current" />
    </span>
  ) : null, [handleStopTask, canStopTask])
  const bashLabel = bashActivities.length > 1 ? `${bashActivities.length} Bashes` : 'Bash'
  const agentLabel = agentActivities.length > 1 ? `${agentActivities.length} Agents` : 'Agent'
  const workflowLabel = workflowActivities.length > 1 ? `${workflowActivities.length} Workflows` : 'Workflow'
  const monitorLabel = monitorActivities.length > 1 ? `${monitorActivities.length} Monitors` : 'Monitor'
  const bashPanelTitle = `Background ${bashActivities.length > 1 ? 'Bashes' : 'Bash'}`
  const agentPanelTitle = `Running ${agentActivities.length > 1 ? 'Agents' : 'Agent'}`
  const workflowPanelTitle = `Running ${workflowActivities.length > 1 ? 'Workflows' : 'Workflow'}`
  const monitorPanelTitle = `Background ${monitorActivities.length > 1 ? 'Monitors' : 'Monitor'}`
  const hasBackgroundWork = bashActivities.length > 0 || agentActivities.length > 0 || workflowActivities.length > 0 || monitorActivities.length > 0

  useEffect(() => {
    if (bashActivities.length === 0) setBashOpen(false)
  }, [bashActivities.length])

  useEffect(() => {
    if (agentActivities.length === 0) setAgentOpen(false)
  }, [agentActivities.length])

  useEffect(() => {
    if (workflowActivities.length === 0) setWorkflowOpen(false)
  }, [workflowActivities.length])

  useEffect(() => {
    if (monitorActivities.length === 0) setMonitorOpen(false)
  }, [monitorActivities.length])

  return (
      <div ref={barRef} className="relative flex items-center gap-2 whitespace-nowrap px-3 pb-0.5 @lg:px-7 text-xs text-muted-foreground">
        <div className="pointer-events-none absolute bottom-full left-3 right-3 z-10 flex flex-col gap-1 pb-1">
          <AnimatePresence>
            {bashOpen && bashActivities.length > 0 && (
              <motion.div
                key="bash-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-popover shadow-md"
              >
                <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground">{bashPanelTitle}</div>
                <div className="activity-panel max-h-[50vh] divide-y divide-border overflow-y-auto p-1.5">
                  {bashActivities.map((item, i) => {
                    const taskId = taskProgress[item.id]?.taskId
                    return (
                      <div key={item.id}>
                        <ToolBlock
                          toolName="Bash"
                          toolUseId={item.toolUse.toolUseId}
                          input={item.toolUse.input}
                          status={item.toolUse.status}
                          elapsedSeconds={item.toolUse.elapsedSeconds}
                          result={item.result?.summary}
                          isTimedOut={item.result?.isTimedOut}
                          resultOutputPath={item.result?.outputPath}
                          autoExpand={i === 0}
                          backgroundActivity
                          trailingAction={taskId ? renderStopButton(taskId) : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
            {agentOpen && agentActivities.length > 0 && (
              <motion.div
                key="agent-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-popover shadow-md"
              >
                <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground">{agentPanelTitle}</div>
                <div className="activity-panel max-h-[50vh] divide-y divide-border overflow-y-auto p-1.5">
                  {agentActivities.map((item, i) => {
                    const taskId = taskProgress[item.id]?.taskId
                    return (
                      <div key={item.id}>
                        <SubagentBlock
                          taskBlock={item.taskBlock}
                          childBlocks={item.childBlocks}
                          resultBlock={item.resultBlock}
                          isStreaming={sessionStatus === 'streaming'}
                          defaultExpanded={i === 0}
                          trailingAction={taskId ? renderStopButton(taskId) : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
            {workflowOpen && workflowActivities.length > 0 && (
              <motion.div
                key="workflow-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-popover shadow-md"
              >
                <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground">{workflowPanelTitle}</div>
                <div className="activity-panel max-h-[50vh] divide-y divide-border overflow-y-auto p-1.5">
                  {workflowActivities.map((item, i) => (
                    <div key={item.id}>
                      <WorkflowBlock
                        toolBlock={item.toolBlock}
                        resultBlock={item.resultBlock}
                        isStreaming={sessionStatus === 'streaming'}
                        defaultExpanded={i === 0}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
            {monitorOpen && monitorActivities.length > 0 && (
              <motion.div
                key="monitor-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-popover shadow-md"
              >
                <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground">{monitorPanelTitle}</div>
                <div className="activity-panel max-h-[50vh] divide-y divide-border overflow-y-auto p-1.5">
                  {monitorActivities.map((item, i) => {
                    const taskId = taskProgress[item.id]?.taskId
                    return (
                      <div key={item.id}>
                        <ToolBlock
                          toolName="Monitor"
                          toolUseId={item.toolUse.toolUseId}
                          input={item.toolUse.input}
                          status={item.toolUse.status}
                          elapsedSeconds={item.toolUse.elapsedSeconds}
                          result={item.result?.summary}
                          isTimedOut={item.result?.isTimedOut}
                          resultOutputPath={item.result?.outputPath}
                          autoExpand={i === 0}
                          backgroundActivity
                          trailingAction={taskId ? renderStopButton(taskId) : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {currentFolder && (
          <WorkDirIndicator
            compact={compactIndicators}
            isGitRepo={isGitRepo}
            onRepositoryReady={() => {
              setIsGitRepo(true)
              void refreshGitInfo()
            }}
          />
        )}

        {gitError && (
          <>
            <div className="h-3 w-px bg-border" />
            <button
              onClick={() => void refreshGitInfo()}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-warning transition-colors hover:bg-muted"
              title={t('chat.git.unavailableHint', { error: gitError })}
            >
              <TriangleAlert className="size-3" />
              {!compactIndicators && <span>{t('chat.git.unavailable')}</span>}
            </button>
          </>
        )}

        <div className="h-3 w-px bg-border" />

        <StatusBarPermission activeProvider={activeProvider} compactIndicators={compactIndicators} />

        <div className="flex-1" />

        {bashActivities.length > 0 && (
          <button
            onClick={() => setBashOpen((o) => !o)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
            title={bashActivities.length > 1 ? `${bashActivities.length} Bashes` : 'Bash'}
          >
            <SquareTerminal className="size-3 animate-pulse" />
            {!compactIndicators && <span>{bashLabel}</span>}
            {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${bashOpen ? 'rotate-180' : ''}`} />}
          </button>
        )}

        {agentActivities.length > 0 && (
          <>
            {bashActivities.length > 0 && <div className="h-3 w-px bg-border" />}
            <button
              onClick={() => setAgentOpen((o) => !o)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
              title={agentLabel}
            >
              <Bot className="size-3 animate-pulse" />
              {!compactIndicators && <span>{agentLabel}</span>}
              {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${agentOpen ? 'rotate-180' : ''}`} />}
            </button>
          </>
        )}

        {workflowActivities.length > 0 && (
          <>
            {(bashActivities.length > 0 || agentActivities.length > 0) && <div className="h-3 w-px bg-border" />}
            <button
              onClick={() => setWorkflowOpen((o) => !o)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
              title={workflowLabel}
            >
              <Workflow className="size-3 animate-pulse" />
              {!compactIndicators && <span>{workflowLabel}</span>}
              {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${workflowOpen ? 'rotate-180' : ''}`} />}
            </button>
          </>
        )}

        {monitorActivities.length > 0 && (
          <>
            {(bashActivities.length > 0 || agentActivities.length > 0 || workflowActivities.length > 0) && <div className="h-3 w-px bg-border" />}
            <button
              onClick={() => setMonitorOpen((o) => !o)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
              title={monitorLabel}
            >
              <Activity className="size-3 animate-pulse" />
              {!compactIndicators && <span>{monitorLabel}</span>}
              {!compactIndicators && <ChevronDown className={`size-3 transition-transform duration-200 ${monitorOpen ? 'rotate-180' : ''}`} />}
            </button>
          </>
        )}

        <StatusBarMailbox sessionId={activeSessionId} />
        <StatusBarSchedules schedules={sessionSchedules} />

        {hiddenPipTarget && (
          <>
            {hasBackgroundWork && (
              <div className="h-3 w-px bg-border" />
            )}
            <StatusBarPip target={hiddenPipTarget} />
          </>
        )}

        <StatusBarSandbox
          activeProvider={activeProvider}
          compactIndicators={compactIndicators}
          showDivider={hasBackgroundWork || hiddenPipTarget != null}
        />
      </div>
  )
}
