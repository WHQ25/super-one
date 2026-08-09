import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Workflow, ChevronRight, Check, Maximize, Loader2, Wrench, Bot, X, CircleStop } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { getSubagentColorClasses } from './subagent-colors'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import {
  parseWorkflowInput,
  parseWorkflowLaunch,
  extractWorkflowScript,
  extractWorkflowScriptPath,
  resolveGrokWorkflowDir,
  workflowArtifactPath,
  stripWorkflowNamePrefix,
} from './workflow-utils'
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
  const cwd = useActiveSession((s) => s.cwd)
  const providerSessionId = useActiveSession((s) => s._providerSessionId)
  const homedir = useChatStore((s) => {
    const path = s.activeProject
    return path ? (s.projectSessions[path]?.homedir || '') : ''
  })
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  useEffect(() => {
    useChatStore.getState().assignSubagentColor(toolBlock.toolUseId)
  }, [toolBlock.toolUseId])
  const meta = useMemo(() => parseWorkflowInput(toolBlock.input), [toolBlock.input])
  const script = useMemo(() => extractWorkflowScript(toolBlock.input), [toolBlock.input])
  const inputScriptPath = useMemo(() => extractWorkflowScriptPath(toolBlock.input), [toolBlock.input])
  const nav = useWorkflowNavigation()

  // Claude: transcriptDir on launch text. Grok: run artifacts under ~/.grok/sessions/.../workflows/<run_id>.
  const transcriptDir = useMemo(() => {
    if (launch.transcriptDir) return launch.transcriptDir
    return resolveGrokWorkflowDir({
      runId: launch.runId ?? runKey,
      cwd,
      providerSessionId,
      homedir,
    })
  }, [launch.transcriptDir, launch.runId, runKey, cwd, providerSessionId, homedir])
  const scriptPath = launch.scriptPath ?? inputScriptPath
    ?? workflowArtifactPath(transcriptDir, 'script.rhai')
  const hasTranscript = !!transcriptDir
  // Claude: transcriptDir. Grok: run_id/task_id on launch JSON and/or live taskProgress.
  const hasLaunchIdentity = hasTranscript || !!runKey || !!progress?.taskId
  const launched = hasLaunchIdentity || !!progress
  // taskProgress is in-memory only.
  // - With live progress: honor completed flag only (parent-turn idle is irrelevant —
  //   background workflows outlive the parent prompt; foreign task_notifications must
  //   not flip completed either — see resolveTaskProgressWrite).
  // - No progress (reload/history): Claude transcriptDir, persisted taskResultText, or
  //   Grok launch id after the parent turn is idle → treat as historical complete.
  // - No progress while still streaming: stay running (avoid complete→running flicker).
  // Historical complete only from explicit launch transcriptDir (Claude), not a
  // synthesized Grok path — otherwise a live run flips to "complete" before progress.
  const isComplete = progress
    ? progress.completed === true
    : !!launch.transcriptDir || !!toolBlock.taskResultText || (!!runKey && !isStreaming)
  const isRunning = launched ? !isComplete : isStreaming
  const isSpawning = !launched && !isComplete && !meta.name
  const terminalStatus = progress?.status

  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const transcriptAgents = useWorkflowAgents(transcriptDir, hasTranscript, isComplete)
  const liveAgents: WorkflowAgentInfo[] = useMemo(() => {
    const rows = progress?.workflowAgents ?? toolBlock.workflowAgents
    if (!rows?.length) return []
    return rows.map((a, i) => ({
      agentId: a.agentId ?? `live-${a.label}-${i}`,
      jsonlPath: '',
      label: a.label,
      toolCount: a.toolCount,
      tokens: a.tokens,
      phase: a.phase,
      state: a.state,
    }))
  }, [progress?.workflowAgents, toolBlock.workflowAgents])
  // Prefer filesystem-backed agents (Claude jsonl / Grok subagent output) when present;
  // still merge live phase/state so full-view List stays current while running.
  const agents = useMemo(() => {
    const base = transcriptAgents.length > 0 ? transcriptAgents : liveAgents
    const liveRows = progress?.workflowAgents ?? toolBlock.workflowAgents
    if (!liveRows?.length) return base
    return base.map((a) => {
      const live = liveRows.find(
        (r) => (r.agentId && r.agentId === a.agentId) || r.label === a.label,
      )
      if (!live) return a
      return {
        ...a,
        phase: a.phase ?? live.phase,
        state: live.state ?? a.state,
        tokens: a.tokens ?? live.tokens,
        toolCount: a.toolCount || live.toolCount,
      }
    })
  }, [transcriptAgents, liveAgents, progress?.workflowAgents, toolBlock.workflowAgents])
  // Full view: Claude transcriptDir, resolved Grok run dir, or script we can show.
  const canOpenFullView = hasTranscript || !!script || !!scriptPath

  const openFullView = () => {
    nav.open({
      toolUseId: toolBlock.toolUseId,
      transcriptDir,
      name: meta.name || toolBlock.workflowName || launch.name || '',
      script,
      scriptPath: script ? undefined : scriptPath,
    })
  }

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
    // Prefer live state, but keep script/meta details when Grok omits detail on snapshots.
    const detailByTitle = new Map(meta.phases.map((p) => [p.title, p.detail] as const))
    if (livePhases?.length) {
      return livePhases.map((p) => ({
        title: p.title,
        detail: p.detail ?? detailByTitle.get(p.title),
        state: p.state,
      }))
    }
    return meta.phases.map((p) => ({ title: p.title, detail: p.detail, state: undefined as string | undefined }))
  }, [livePhases, meta.phases])

  // Prefer human name — never surface run_id (wf_…) as the title chip.
  const nameForStrip = meta.name || toolBlock.workflowName || launch.name || undefined
  const displayName = nameForStrip || t('chat.workflow.title', 'Workflow')
  const displayDescription = stripWorkflowNamePrefix(
    meta.description
      || toolBlock.workflowDescription
      || progress?.description
      || undefined,
    nameForStrip,
  )

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
          {displayName === t('chat.workflow.title', 'Workflow')
            ? displayName
            : `Workflow: ${displayName}`}
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
              onClick={(e) => { e.stopPropagation(); openFullView() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); openFullView() } }}
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
                  const liveState = agent.state
                    ?? progress?.workflowAgents?.find(
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
                      onClick={() => openFullView()}
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
                  {stripWorkflowNamePrefix(
                    progress?.summary || progress?.description || toolBlock.taskSummary,
                    nameForStrip,
                  )
                    || t('chat.workflow.running', 'Running…')}
                </span>
              </>
            ) : terminalStatus === 'failed' ? (
              <>
                <X className="size-3 shrink-0 text-destructive" />
                <span>
                  {t('chat.workflow.failed', 'Workflow failed')}
                  {(() => {
                    const s = stripWorkflowNamePrefix(progress?.summary, nameForStrip)
                    return s ? ` · ${s}` : ''
                  })()}
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
