import { useState, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  Loader2,
  Maximize,
  Workflow,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { SubagentColorClasses } from './SubagentBlock'

export interface WorkflowPhaseView {
  title: string
  detail?: string
  state?: string
}

export interface WorkflowAgentView {
  agentId: string
  label: string
  toolCount: number
  tokens?: number
  state?: string
}

export interface WorkflowStructuredOutputProps {
  data: string
  fill?: boolean
}

export interface WorkflowBlockPresenterProps {
  colors: SubagentColorClasses
  name?: string
  description?: string
  isSpawning: boolean
  isRunning: boolean
  isComplete: boolean
  terminalStatus?: 'completed' | 'failed' | 'stopped'
  activePhase?: string
  phases: WorkflowPhaseView[]
  agents: WorkflowAgentView[]
  totalTokens: number
  elapsed: number
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  canOpenFullView: boolean
  onOpenFullView: () => void
  retryBadge?: ReactNode
  logs: string[]
  resultText?: string
  runningSummary?: string
  terminalSummary?: string
  formatTokens: (tokens: number) => string
  StructuredOutput: ComponentType<WorkflowStructuredOutputProps>
}

function formatElapsed(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function LogOutputPanel({
  logs,
  resultText,
  StructuredOutput,
}: Pick<WorkflowBlockPresenterProps, 'logs' | 'resultText' | 'StructuredOutput'>) {
  const { t } = useTranslation()
  const hasLog = logs.length > 0
  const hasOutput = !!resultText
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'output' | 'log'>('output')
  if (!hasLog && !hasOutput) return null
  const active = tab === 'log' && hasLog ? 'log' : hasOutput ? 'output' : 'log'
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
          onClick={() => setOpen((shown) => !shown)}
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
            <StructuredOutput data={resultText} fill />
          ) : hasLog ? (
            <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-xs leading-relaxed text-muted-foreground">
              {logs.map((line, index) => (
                <div key={index} className="whitespace-pre-wrap break-words">{line}</div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function WorkflowBlockPresenter({
  colors,
  name,
  description,
  isSpawning,
  isRunning,
  isComplete,
  terminalStatus,
  activePhase,
  phases,
  agents,
  totalTokens,
  elapsed,
  expanded,
  onExpandedChange,
  canOpenFullView,
  onOpenFullView,
  retryBadge,
  logs,
  resultText,
  runningSummary,
  terminalSummary,
  formatTokens,
  StructuredOutput,
}: WorkflowBlockPresenterProps) {
  const { t } = useTranslation()
  const title = name ? `Workflow: ${name}` : t('chat.workflow.title', 'Workflow')
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
        onClick={() => onExpandedChange(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
      >
        <Workflow className={cn('size-3.5 shrink-0', colors.text, isRunning && !expanded && 'animate-pulse')} />
        <span className={cn('shrink-0 rounded px-1 py-px text-xs font-medium', colors.tagBg, colors.tagText)}>
          {title}
        </span>
        {description && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{description}</span>
        )}
        {isSpawning && (
          <span className="min-w-0 text-left text-muted-foreground">
            {t('chat.workflow.spawning', 'Starting workflow…')}
          </span>
        )}
        {isRunning && retryBadge}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {!expanded && activePhase && <span className="text-primary">{activePhase}</span>}
          {!expanded && stats}
          {expanded && canOpenFullView && (
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                onOpenFullView()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation()
                  onOpenFullView()
                }
              }}
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
                {phases.map((phase, index) => {
                  const showActive = isRunning
                    && (phase.state === 'active' || (!phase.state && activePhase === phase.title))
                  const showDone = phase.state === 'done'
                    || (!isRunning && isComplete && terminalStatus === 'completed' && !phase.state)
                  return (
                    <div key={index} className="flex items-baseline gap-1.5 text-xs">
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
                  const row = (
                    <>
                      <Bot className="size-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate text-foreground">{agent.label}</span>
                      {agent.state && <span className="shrink-0 text-muted-foreground/80">{agent.state}</span>}
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
                  return canOpenFullView ? (
                    <button
                      key={agent.agentId}
                      type="button"
                      onClick={onOpenFullView}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60"
                    >
                      {row}
                    </button>
                  ) : (
                    <div
                      key={agent.agentId}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs"
                    >
                      {row}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <LogOutputPanel logs={logs} resultText={resultText} StructuredOutput={StructuredOutput} />

          <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-xs text-muted-foreground">
            {isRunning ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                <span>{runningSummary || t('chat.workflow.running', 'Running…')}</span>
              </>
            ) : terminalStatus === 'failed' ? (
              <>
                <X className="size-3 shrink-0 text-destructive" />
                <span>
                  {t('chat.workflow.failed', 'Workflow failed')}
                  {terminalSummary ? ` · ${terminalSummary}` : ''}
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
