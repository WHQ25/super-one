import { useState, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, Check, ChevronRight, Loader2, TriangleAlert } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import {
  groupWorkflowAgents,
  workflowAgentTileStatus,
  type WorkflowAgentTileStatus,
  type WorkflowChildSection,
  type WorkflowPhase,
  type WorkflowPhaseSection,
  type WorkflowSubworkflowInfo,
} from './workflow-utils'

export interface WorkflowTileAgent {
  agentId: string
  label: string
  toolCount: number
  tokens?: number
  state?: string
  phase?: string
  subworkflow?: string
}

interface TileContext {
  isRunning: boolean
  /** The workflow card's assigned text colour; tiles draw from it via currentColor. */
  accent: string
  formatTokens: (tokens: number) => string
  onOpenAgent?: (agentId: string) => void
}

// Tiles paint in currentColor, which is the card's accent for every state but
// queued; agents that ended without finishing show a bare glyph instead of a fill.
const TILE_CLASS: Record<WorkflowAgentTileStatus, string> = {
  done: 'bg-current/30',
  running: 'bg-current animate-pulse',
  failed: '',
  stopped: '',
  queued: 'border border-dashed border-current/70',
}

function tileClass(status: WorkflowAgentTileStatus, accent: string): string {
  return cn(status === 'queued' ? 'text-muted-foreground' : accent, TILE_CLASS[status])
}

function TileGlyph({ status }: { status: WorkflowAgentTileStatus }) {
  if (status === 'failed') return <TriangleAlert className="size-full stroke-[1.75] opacity-70" />
  if (status === 'stopped') return <Ban className="size-full stroke-[1.75] opacity-70" />
  return null
}

function AgentTile({ agent, path, small, ctx }: {
  agent: WorkflowTileAgent
  path: string
  small?: boolean
  ctx: TileContext
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pointerType, setPointerType] = useState<string>()
  const status = workflowAgentTileStatus(agent.state, ctx.isRunning)
  const onHover = (show: boolean) => (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setOpen(show)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={agent.label}
          data-status={status}
          onPointerDown={(event) => setPointerType(event.pointerType)}
          onPointerEnter={onHover(true)}
          onPointerLeave={onHover(false)}
          onClick={(event) => {
            // Mouse users already see the card on hover; a click opens the agent.
            // Touch has no hover, so a tap toggles the card instead.
            if (pointerType === 'mouse' && ctx.onOpenAgent) {
              event.preventDefault()
              ctx.onOpenAgent(agent.agentId)
            }
          }}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-[3px] transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            small ? 'size-2.5' : 'size-3.5',
            tileClass(status, ctx.accent),
          )}
        >
          <TileGlyph status={status} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="pointer-events-none w-auto min-w-48 max-w-72 space-y-1 p-2.5 text-xs"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="break-words font-mono font-medium text-foreground">{agent.label}</div>
        <TileRow label={t('chat.workflow.agentState', 'Status')}>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('flex size-2.5 shrink-0 items-center justify-center rounded-[2px]', tileClass(status, ctx.accent))}>
              <TileGlyph status={status} />
            </span>
            {t(`chat.workflow.agentStatus.${status}`)}
          </span>
        </TileRow>
        {path && <TileRow label={t('chat.workflow.phase', 'Phase')}>{path}</TileRow>}
        <TileRow label={t('chat.workflow.toolCalls', 'Tool Calls')}>{agent.toolCount}</TileRow>
        <TileRow label={t('chat.workflow.tokens', 'Tokens')}>
          {agent.tokens ? agent.tokens.toLocaleString() : '—'}
        </TileRow>
      </PopoverContent>
    </Popover>
  )
}

function TileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums text-foreground">{children}</span>
    </div>
  )
}

function TileRowOf({ agents, path, small, ctx }: {
  agents: WorkflowTileAgent[]
  path: string
  small?: boolean
  ctx: TileContext
}) {
  if (agents.length === 0) return null
  return (
    <div className={cn('mt-1 flex flex-wrap pl-4', small ? 'gap-0.5' : 'gap-1')}>
      {agents.map((agent) => (
        <AgentTile key={agent.agentId} agent={agent} path={path} small={small} ctx={ctx} />
      ))}
    </div>
  )
}

function joinPath(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' › ')
}

function PhaseHeader({ phase, agents, indicator, ctx }: {
  phase: WorkflowPhase
  agents: WorkflowTileAgent[]
  indicator: 'active' | 'done' | 'idle'
  ctx: TileContext
}) {
  const done = agents.filter((agent) => workflowAgentTileStatus(agent.state, ctx.isRunning) === 'done').length
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 text-xs">
      <span className="flex w-2.5 shrink-0 justify-center">
        {indicator === 'active' && <Loader2 className={cn('size-2.5 animate-spin', ctx.accent)} />}
        {indicator === 'done' && <Check className="size-2.5 text-muted-foreground" />}
      </span>
      <span className={cn(
        'shrink-0 font-medium',
        indicator === 'active' ? ctx.accent : indicator === 'done' ? 'text-muted-foreground' : 'text-foreground',
      )}>
        {phase.title}
      </span>
      {phase.detail && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={phase.detail}>{phase.detail}</span>
      )}
      {agents.length > 0 && (
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{done}/{agents.length}</span>
      )}
    </div>
  )
}

function ChildWorkflow({ child, hostPath, ctx }: {
  child: WorkflowChildSection<WorkflowTileAgent>
  hostPath: string
  ctx: TileContext
}) {
  const [open, setOpen] = useState(true)
  const all = child.sections.flatMap((section) => section.agents)
  const done = all.filter((agent) => workflowAgentTileStatus(agent.state, ctx.isRunning) === 'done').length
  const tokens = all.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0)
  const path = joinPath(hostPath, child.workflow.name)
  return (
    <div className="ml-4 mt-1.5 border-l border-border/60 pl-2.5">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-xs"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 rounded border border-border/60 bg-background px-1 font-medium">{child.workflow.name}</span>
        {child.workflow.description && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{child.workflow.description}</span>
        )}
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
          {tokens > 0 && `${ctx.formatTokens(tokens)} · `}{done}/{all.length}
        </span>
      </button>
      {open
        ? child.sections.map((section) => (
          <PhaseSection key={section.phase.title} section={section} path={joinPath(path, section.phase.title)} indicator={sectionIndicator(section.agents, ctx.isRunning)} ctx={ctx} />
        ))
        : <TileRowOf agents={all} path={path} small ctx={ctx} />}
    </div>
  )
}

function PhaseSection({ section, counted = section.agents, path, indicator, ctx, children }: {
  section: WorkflowPhaseSection<WorkflowTileAgent>
  /** Agents behind the done/total count: the phase's own plus its child workflows'. */
  counted?: WorkflowTileAgent[]
  path: string
  indicator: 'active' | 'done' | 'idle'
  ctx: TileContext
  children?: ReactNode
}) {
  return (
    <div className="py-1">
      {section.phase.title && <PhaseHeader phase={section.phase} agents={counted} indicator={indicator} ctx={ctx} />}
      <TileRowOf agents={section.agents} path={path} ctx={ctx} />
      {children}
    </div>
  )
}

function sectionIndicator(agents: WorkflowTileAgent[], isRunning: boolean): 'active' | 'done' | 'idle' {
  if (agents.length === 0) return 'idle'
  const statuses = agents.map((agent) => workflowAgentTileStatus(agent.state, isRunning))
  if (statuses.includes('running')) return 'active'
  if (statuses.every((s) => s === 'done' || s === 'failed')) return 'done'
  return 'idle'
}

export interface WorkflowPhaseGroupsProps {
  phases: WorkflowPhase[]
  agents: WorkflowTileAgent[]
  subworkflows?: WorkflowSubworkflowInfo[]
  isRunning: boolean
  /** Workflow ended with `completed`: phases without agent data count as done. */
  completed: boolean
  activePhase?: string
  /** The workflow card's assigned text colour class. */
  accent: string
  formatTokens: (tokens: number) => string
  onOpenAgent?: (agentId: string) => void
}

/** Phase rows (title, detail, done/total) each followed by one tile per agent. */
export function WorkflowPhaseGroups({
  phases,
  agents,
  subworkflows,
  isRunning,
  completed,
  activePhase,
  accent,
  formatTokens,
  onOpenAgent,
}: WorkflowPhaseGroupsProps) {
  const groups = groupWorkflowAgents(phases, agents, subworkflows)
  const ctx: TileContext = { isRunning, accent, formatTokens, onOpenAgent }
  const started = groups.map((group) => group.agents.length > 0 || group.children.length > 0)
  return (
    <div className="px-3 py-1.5">
      {groups.map((group, index) => {
        const all = [...group.agents, ...group.children.flatMap((child) => child.sections.flatMap((s) => s.agents))]
        const fromAgents = sectionIndicator(all, isRunning)
        const laterStarted = started.slice(index + 1).some(Boolean)
        const indicator = isRunning && (group.phase.state === 'active' || (!group.phase.state && (fromAgents === 'active' || activePhase === group.phase.title)))
          ? 'active'
          : group.phase.state === 'done'
            || (!group.phase.state && fromAgents === 'done' && (!isRunning || laterStarted))
            || (!isRunning && completed && !group.phase.state)
            ? 'done'
            : 'idle'
        return (
          <PhaseSection
            key={group.phase.title || `phase-${index}`}
            section={group}
            counted={all}
            path={group.phase.title}
            indicator={indicator}
            ctx={ctx}
          >
            {group.children.map((child) => (
              <ChildWorkflow key={child.workflow.name} child={child} hostPath={group.phase.title} ctx={ctx} />
            ))}
          </PhaseSection>
        )
      })}
    </div>
  )
}
