import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Workflow, ChevronRight, Check, Maximize, Loader2, Wrench, Bot, X, CircleStop } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { getSubagentColorClasses } from './subagent-colors'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import { parseWorkflowInput, parseWorkflowLaunch, extractWorkflowScript } from './workflow-utils'
import { useWorkflowAgents, type WorkflowAgentInfo } from './use-workflow-agents'
import { useWorkflowOutput } from './use-workflow-output'
import { useWorkflowNavigation } from './workflow-navigation-context'
import { StructuredOutputView } from './StructuredOutputView'

interface WorkflowBlockProps {
  toolBlock: ContentBlock & { type: 'tool_use' }
  resultBlock?: ContentBlock
  isStreaming: boolean
  defaultExpanded?: boolean
}

function formatElapsed(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function phaseFromSummary(summary?: string): string | undefined {
  if (!summary) return undefined
  const m = summary.match(/(?:^|·\s*)phase:\s*([^·]+)/i)
  return m?.[1]?.trim() || undefined
}

function LogOutputPanel({ logs, resultText }: { logs: string[]; resultText?: string }) {
  const { t } = useTranslation()
  const hasLog = logs.length > 0
  const hasOutput = !!resultText
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'output' | 'log'>('output')
  if (!hasLog && !hasOutput) return null
  const active: 'output' | 'log' = tab === 'log' && hasLog ? 'log' : hasOutput ? 'output' : 'log'
  const title = hasLog && hasOutput
    ? t('chat.workflow.logOutput', 'Log / Output')
    : hasOutput
      ? t('chat.workflow.output', 'Output')
      : t('chat.workflow.log', 'Log')

  return (
    <div className="border-t border-border/30">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          {title}
        </button>
        {open && hasLog && hasOutput && (
          <div className="ml-auto flex items-center gap-0.5 rounded bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setTab('output')}
              className={cn('rounded px-1.5 py-0.5 text-xs', active === 'output' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t('chat.workflow.output', 'Output')}
            </button>
            <button
              type="button"
              onClick={() => setTab('log')}
              className={cn('rounded px-1.5 py-0.5 text-xs', active === 'log' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t('chat.workflow.log', 'Log')}
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="px-3 pb-1.5">
          {active === 'output' && resultText ? (
            <StructuredOutputView data={resultText} fill />
          ) : hasLog ? (
            <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-xs leading-relaxed text-muted-foreground">
              {logs.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function WorkflowBlock({ toolBlock, resultBlock, isStreaming, defaultExpanded }: WorkflowBlockProps) {
  const { t } = useTranslation()
  const launch = useMemo(
    () => parseWorkflowLaunch(resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined),
    [resultBlock],
  )
  const runKey = launch.runId ?? launch.taskId
  const progress = useActiveSession((s) => {
    const byTool = s.taskProgress[toolBlock.toolUseId]
    if (byTool) return byTool
    if (runKey) {
      if (s.taskProgress[runKey]) return s.taskProgress[runKey]
      for (const entry of Object.values(s.taskProgress)) {
        if (entry.taskId === runKey) return entry
      }
    }
    return undefined
  })
  const colorIdx = useActiveSession((s) => s.subagentColors[toolBlock.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  useEffect(() => {
    useChatStore.getState().assignSubagentColor(toolBlock.toolUseId)
  }, [toolBlock.toolUseId])
  const meta = useMemo(() => parseWorkflowInput(toolBlock.input), [toolBlock.input])
  const script = useMemo(() => extractWorkflowScript(toolBlock.input), [toolBlock.input])
  const nav = useWorkflowNavigation()

  const hasTranscript = !!launch.transcriptDir
  // Claude: transcriptDir. Grok: run_id/task_id on launch JSON and/or live taskProgress.
  const hasLaunchIdentity = hasTranscript || !!runKey || !!progress?.taskId
  const launched = hasLaunchIdentity || !!progress
  // taskProgress is in-memory only.
  // - With live progress: honor completed flag.
  // - Claude transcript without progress (reload/history): complete.
  // - Grok launch JSON without progress yet: stay running while parent turn streams
  //   (avoid complete→running flicker before first workflow_updated); when idle, treat as historical complete.
  const isComplete = progress
    ? progress.completed === true
    : hasTranscript || (!!runKey && !isStreaming)
  const isRunning = launched ? !isComplete : isStreaming
  const isSpawning = !launched && !isComplete && !meta.name
  const terminalStatus = progress?.status

  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const transcriptAgents = useWorkflowAgents(launch.transcriptDir, hasTranscript, isComplete)
  const liveAgents: WorkflowAgentInfo[] = useMemo(() => {
    const rows = progress?.workflowAgents ?? toolBlock.workflowAgents
    if (!rows?.length) return []
    return rows.map((a, i) => ({
      agentId: a.agentId ?? `live-${a.label}-${i}`,
      jsonlPath: '',
      label: a.label,
      toolCount: a.toolCount,
      tokens: a.tokens,
    }))
  }, [progress?.workflowAgents, toolBlock.workflowAgents])
  // Prefer Claude transcript agents when present; otherwise Grok snapshot rows (no jsonl).
  const agents = transcriptAgents.length > 0 ? transcriptAgents : liveAgents
  const canOpenFullView = hasTranscript

  const outputFile = progress?.outputFile ?? (resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined)
  const output = useWorkflowOutput(outputFile, expanded && hasTranscript)
  const resultText = useMemo(() => {
    if (progress?.resultText) return progress.resultText
    if (typeof toolBlock.taskResultText === 'string' && toolBlock.taskResultText) return toolBlock.taskResultText
    if (!output || output.result === undefined) return undefined
    return typeof output.result === 'string' ? output.result : JSON.stringify(output.result, null, 2)
  }, [progress?.resultText, toolBlock.taskResultText, output])

  const elapsed = progress?.durationMs ? Math.round(progress.durationMs / 1000) : 0
  const agentsTokens = useMemo(() => agents.reduce((sum, a) => sum + (a.tokens ?? 0), 0), [agents])
  const totalTokens = progress?.totalTokens || agentsTokens
  // Never surface a live phase chip/spinner after terminal (persisted currentPhase stays on the block).
  const activePhase = isRunning
    ? (progress?.currentPhase
      ?? toolBlock.workflowCurrentPhase
      ?? phaseFromSummary(progress?.summary ?? toolBlock.taskSummary))
    : undefined

  const livePhases = progress?.workflowPhases ?? toolBlock.workflowPhases
  const phases = useMemo(() => {
    if (livePhases?.length) {
      return livePhases.map((p) => ({
        title: p.title,
        detail: p.detail,
        state: p.state,
      }))
    }
    return meta.phases.map((p) => ({ title: p.title, detail: p.detail, state: undefined as string | undefined }))
  }, [livePhases, meta.phases])

  const displayName = meta.name || launch.runId || t('chat.workflow.title', 'Workflow')
  const displayDescription =
    meta.description
    || (progress?.description && !progress.description.startsWith(`${meta.name}:`) ? progress.description : undefined)

  const stats = (
    <>
      {agents.length > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Bot className="size-3" />
          {agents.length}
        </span>
      )}
      {totalTokens > 0 && (
        <>
          {agents.length > 0 && <span>·</span>}
          <span className="tabular-nums">{formatTokens(totalTokens)}</span>
        </>
      )}
    </>
  )

  return (
    <div className="workflow-container my-1 overflow-hidden rounded border border-border/50 bg-muted/20">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
      >
        <Workflow className={cn('size-3.5 shrink-0', colors.text, isRunning && !expanded && 'animate-pulse')} />
        <span className={cn('shrink-0 rounded px-1 py-px text-xs font-medium', colors.tagBg, colors.tagText)}>
          {meta.name || launch.runId ? `Workflow: ${displayName}` : t('chat.workflow.title', 'Workflow')}
        </span>
        {displayDescription && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{displayDescription}</span>
        )}
        {isSpawning && (
          <span className="min-w-0 text-left text-muted-foreground">{t('chat.workflow.spawning', 'Starting workflow…')}</span>
        )}
        {isRunning && progress?.retry && <SubagentRetryBadge retry={progress.retry} className="ml-1" />}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {!expanded && activePhase && <span className="text-primary">{activePhase}</span>}
          {!expanded && stats}
          {expanded && canOpenFullView && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); nav.open({ toolUseId: toolBlock.toolUseId, transcriptDir: launch.transcriptDir, name: meta.name, script }) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); nav.open({ toolUseId: toolBlock.toolUseId, transcriptDir: launch.transcriptDir, name: meta.name, script }) } }}
              className="inline-flex items-center rounded p-0.5 hover:bg-muted hover:text-foreground"
              title={t('chat.subagent.openFullView', 'Open full view')}
            >
              <Maximize className="size-3" />
            </span>
          )}
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-90')} />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/30">
          {phases.length > 0 && (
            <div className="px-3 py-1.5">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.workflow.phases', 'Phases')}
              </div>
              <div className="space-y-0.5">
                {phases.map((phase, i) => {
                  const showActive = isRunning && (phase.state === 'active' || (!phase.state && activePhase === phase.title))
                  // Only paint success checks on explicit done, or when the whole run completed successfully.
                  // Failed/stopped must not mark pending/active phases as successful.
                  const showDone = phase.state === 'done'
                    || (!isRunning && isComplete && terminalStatus === 'completed' && !phase.state)
                  return (
                    <div key={i} className="flex items-baseline gap-1.5 text-xs">
                      <span className={cn(
                        'shrink-0 font-medium',
                        showActive ? 'text-primary' : showDone ? 'text-muted-foreground' : 'text-foreground',
                      )}>
                        {showActive && <Loader2 className="mr-1 inline size-2.5 animate-spin" />}
                        {showDone && !showActive && <Check className="mr-1 inline size-2.5 text-success" />}
                        {phase.title}
                      </span>
                      {phase.detail && <span className="min-w-0 truncate text-muted-foreground">{phase.detail}</span>}
                      {isRunning && phase.state && phase.state !== 'done' && phase.state !== 'active' && (
                        <span className="text-muted-foreground/80">({phase.state})</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {agents.length > 0 && (
            <div className="border-t border-border/30 px-3 py-1.5">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.workflow.agents', 'Agents')} ({agents.length})
              </div>
              <div className="max-h-32 space-y-0.5 overflow-y-auto">
                {agents.map((agent) => {
                  const liveState = progress?.workflowAgents?.find(
                    (a) => (a.agentId && a.agentId === agent.agentId) || a.label === agent.label,
                  )?.state
                  const row = (
                    <>
                      <Bot className="size-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate text-foreground">{agent.label}</span>
                      {liveState && (
                        <span className="shrink-0 text-muted-foreground/80">{liveState}</span>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
                        {agent.toolCount > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Wrench className="size-2.5" />
                            {agent.toolCount}
                          </span>
                        )}
                        {agent.tokens != null && agent.tokens > 0 && (
                          <>
                            {agent.toolCount > 0 && <span>·</span>}
                            <span className="tabular-nums">{formatTokens(agent.tokens)}</span>
                          </>
                        )}
                      </span>
                    </>
                  )
                  if (!canOpenFullView) {
                    return (
                      <div
                        key={agent.agentId}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs"
                      >
                        {row}
                      </div>
                    )
                  }
                  return (
                    <button
                      key={agent.agentId}
                      type="button"
                      onClick={() => nav.open({ toolUseId: toolBlock.toolUseId, transcriptDir: launch.transcriptDir, name: meta.name, script })}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60"
                    >
                      {row}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <LogOutputPanel logs={output?.logs ?? []} resultText={resultText} />

          <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-xs text-muted-foreground">
            {isRunning ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                <span>
                  {progress?.summary
                    || progress?.description
                    || toolBlock.taskSummary
                    || t('chat.workflow.running', 'Running…')}
                </span>
              </>
            ) : terminalStatus === 'failed' ? (
              <>
                <X className="size-3 shrink-0 text-destructive" />
                <span>
                  {t('chat.workflow.failed', 'Workflow failed')}
                  {progress?.summary ? ` · ${progress.summary}` : ''}
                  {elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
                </span>
              </>
            ) : terminalStatus === 'stopped' ? (
              <>
                <CircleStop className="size-3 shrink-0 text-muted-foreground" />
                <span>
                  {t('chat.workflow.stopped', 'Workflow stopped')}
                  {elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
                </span>
              </>
            ) : (
              <>
                <Check className="size-3 shrink-0 text-success" />
                <span>
                  {t('chat.workflow.done', 'Workflow complete')}
                  {elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
                </span>
              </>
            )}
            <span className="ml-auto flex items-center gap-1.5">{stats}</span>
          </div>
        </div>
      )}
    </div>
  )
}
