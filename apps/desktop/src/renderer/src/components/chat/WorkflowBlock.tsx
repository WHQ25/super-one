import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Workflow, ChevronRight, Check, Maximize, Loader2, Wrench, Bot } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { getSubagentColorClasses } from './subagent-colors'
import { parseWorkflowInput, parseWorkflowLaunch, extractWorkflowScript } from './workflow-utils'
import { useWorkflowAgents } from './use-workflow-agents'
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

function currentPhaseTitle(description?: string): string | undefined {
  if (!description) return undefined
  const idx = description.indexOf(':')
  return idx > 0 ? description.slice(0, idx).trim() : undefined
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
          className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          {title}
        </button>
        {open && hasLog && hasOutput && (
          <div className="ml-auto flex items-center gap-0.5 rounded bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setTab('output')}
              className={cn('rounded px-1.5 py-0.5 text-[10px]', active === 'output' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t('chat.workflow.output', 'Output')}
            </button>
            <button
              type="button"
              onClick={() => setTab('log')}
              className={cn('rounded px-1.5 py-0.5 text-[10px]', active === 'log' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
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
            <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
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
  const progress = useActiveSession((s) => s.taskProgress[toolBlock.toolUseId])
  const colorIdx = useActiveSession((s) => s.subagentColors[toolBlock.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  useEffect(() => {
    useChatStore.getState().assignSubagentColor(toolBlock.toolUseId)
  }, [toolBlock.toolUseId])
  const meta = useMemo(() => parseWorkflowInput(toolBlock.input), [toolBlock.input])
  const script = useMemo(() => extractWorkflowScript(toolBlock.input), [toolBlock.input])
  const launch = useMemo(
    () => parseWorkflowLaunch(resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined),
    [resultBlock],
  )
  const nav = useWorkflowNavigation()

  const launched = !!launch.transcriptDir
  // taskProgress is in-memory only: a reloaded/historical workflow has no progress entry,
  // so treat "launched but no live progress" as complete instead of running forever.
  const isComplete = launched && (progress ? progress.completed === true : true)
  const isRunning = launched ? !isComplete : isStreaming
  const isSpawning = !launched && !isComplete && !meta.name

  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const agents = useWorkflowAgents(launch.transcriptDir, true, isComplete)
  const outputFile = progress?.outputFile ?? (resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined)
  const output = useWorkflowOutput(outputFile, expanded)
  const resultText = useMemo(() => {
    if (!output || output.result === undefined) return undefined
    return typeof output.result === 'string' ? output.result : JSON.stringify(output.result, null, 2)
  }, [output])

  const elapsed = progress?.durationMs ? Math.round(progress.durationMs / 1000) : 0
  const agentsTokens = useMemo(() => agents.reduce((sum, a) => sum + (a.tokens ?? 0), 0), [agents])
  const totalTokens = progress?.totalTokens || agentsTokens
  const activePhase = isRunning ? currentPhaseTitle(progress?.description) : undefined

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
        <span className={cn('shrink-0 rounded px-1 py-px text-[10px] font-medium', colors.tagBg, colors.tagText)}>
          {meta.name ? `Workflow: ${meta.name}` : t('chat.workflow.title', 'Workflow')}
        </span>
        {meta.description && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{meta.description}</span>
        )}
        {isSpawning && (
          <span className="min-w-0 text-left text-muted-foreground">{t('chat.workflow.spawning', 'Starting workflow…')}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {!expanded && activePhase && <span className="text-primary">{activePhase}</span>}
          {!expanded && stats}
          {expanded && launch.transcriptDir && (
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
          {meta.phases.length > 0 && (
            <div className="px-3 py-1.5">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.workflow.phases', 'Phases')}
              </div>
              <div className="space-y-0.5">
                {meta.phases.map((phase, i) => {
                  const active = activePhase === phase.title
                  return (
                    <div key={i} className="flex items-baseline gap-1.5 text-[11px]">
                      <span className={cn('shrink-0 font-medium', active ? 'text-primary' : 'text-foreground')}>
                        {active && <Loader2 className="mr-1 inline size-2.5 animate-spin" />}
                        {phase.title}
                      </span>
                      {phase.detail && <span className="min-w-0 truncate text-muted-foreground">{phase.detail}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {agents.length > 0 && (
            <div className="border-t border-border/30 px-3 py-1.5">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.workflow.agents', 'Agents')} ({agents.length})
              </div>
              <div className="max-h-32 space-y-0.5 overflow-y-auto">
                {agents.map((agent) => (
                  <button
                    key={agent.agentId}
                    type="button"
                    onClick={() => nav.open({ toolUseId: toolBlock.toolUseId, transcriptDir: launch.transcriptDir, name: meta.name, script })}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted/60"
                  >
                    <Bot className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-foreground">{agent.label}</span>
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
                  </button>
                ))}
              </div>
            </div>
          )}

          <LogOutputPanel logs={output?.logs ?? []} resultText={resultText} />

          <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {isRunning ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                <span>{progress?.description || t('chat.workflow.running', 'Running…')}</span>
              </>
            ) : (
              <>
                <Check className="size-3 shrink-0 text-green-600 dark:text-green-400" />
                <span>{t('chat.workflow.done', 'Workflow complete')}{elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}</span>
              </>
            )}
            <span className="ml-auto flex items-center gap-1.5">{stats}</span>
          </div>
        </div>
      )}
    </div>
  )
}
