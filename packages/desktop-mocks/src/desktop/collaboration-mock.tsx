"use client"

import type { ComponentType, ReactNode } from "react"
import {
  ArrowRightLeft,
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock3,
  Globe2,
  Link2,
  LoaderCircle,
  MessagesSquare,
  Network,
  TriangleAlert,
  UserRoundPlus,
  UsersRound,
} from "lucide-react"
import { Badge } from "@superone/ui/components/ui/badge"
import { cn } from "@superone/ui/lib/utils"
import { HarnessSessionIcon, type Harness } from "./icons"
import { harnessShowcaseMeta } from "./showcase-catalog"

export type CollaborationHarnessMock = Harness

export type CollaborationStatusMock =
  | "pending"
  | "running"
  | "waiting"
  | "complete"
  | "error"

export type CollaborationModeMock = "spawn" | "link" | "handoff" | "wait"

export interface CollaborationSubtaskMock {
  id: string
  title: string
  status: CollaborationStatusMock
}

export interface CollaborationAgentMock {
  id: string
  name: string
  harness: CollaborationHarnessMock
  role: string
  task: string
  status: CollaborationStatusMock
  parentId?: string
  subtasks?: CollaborationSubtaskMock[]
}

export interface CollaborationEventMock {
  id: string
  mode: CollaborationModeMock
  target: string
  harness?: CollaborationHarnessMock
  summary?: string
  status?: CollaborationStatusMock
}

export interface CollaborationCoordinatorMock {
  name: string
  harness: CollaborationHarnessMock
  task: string
}

export interface CollaborationMockProps {
  title?: string
  coordinator?: CollaborationCoordinatorMock
  agents?: CollaborationAgentMock[]
  events?: CollaborationEventMock[]
  className?: string
}

interface BrowserCloseFailureMock {
  tab: string
  reason: string
}

export interface BrowserCloseResultMockProps {
  closedTabs?: string[]
  failedTabs?: BrowserCloseFailureMock[]
  streaming?: boolean
  className?: string
}

const DEFAULT_COORDINATOR: CollaborationCoordinatorMock = {
  name: "Orchestrator",
  harness: "claude",
  task: "Coordinate the UI refresh and merge verified results",
}

const DEFAULT_EVENTS: CollaborationEventMock[] = [
  {
    id: "spawn-builder",
    mode: "spawn",
    target: "Canvas builder",
    harness: "codex",
    summary: "new worktree · implement turn details",
    status: "complete",
  },
  {
    id: "link-audit",
    mode: "link",
    target: "Accessibility audit",
    harness: "cursor",
    summary: "existing session linked",
    status: "complete",
  },
  {
    id: "wait-agents",
    mode: "wait",
    target: "2 agents",
    summary: "implementation running · reviewer waiting",
    status: "running",
  },
  {
    id: "handoff-release",
    mode: "handoff",
    target: "Release reviewer",
    harness: "acp",
    summary: "starts when implementation is ready",
    status: "pending",
  },
]

const DEFAULT_AGENTS: CollaborationAgentMock[] = [
  {
    id: "builder",
    name: "Canvas builder",
    harness: "codex",
    role: "Implementer",
    task: "Build the completed-turn Details mock and stories",
    status: "running",
    subtasks: [
      { id: "inventory", title: "Map current turn behavior", status: "complete" },
      { id: "component", title: "Implement compact and expanded states", status: "running" },
      { id: "typecheck", title: "Run package typecheck", status: "pending" },
    ],
  },
  {
    id: "reviewer",
    parentId: "builder",
    name: "Tool UI reviewer",
    harness: "opencode",
    role: "Reviewer",
    task: "Review compact tool rows and semantic token usage",
    status: "waiting",
    subtasks: [
      { id: "review-browser", title: "Verify browser close partial result", status: "waiting" },
    ],
  },
  {
    id: "audit",
    name: "Accessibility audit",
    harness: "cursor",
    role: "Linked session",
    task: "Check disclosure labels, focus order, and status clarity",
    status: "complete",
    subtasks: [
      { id: "aria", title: "Audit disclosure semantics", status: "complete" },
      { id: "contrast", title: "Review light and dark contrast", status: "complete" },
    ],
  },
  {
    id: "release",
    name: "Release reviewer",
    harness: "acp",
    role: "Handoff",
    task: "Take over final visual verification and release notes",
    status: "pending",
    subtasks: [
      { id: "release-review", title: "Review final Storybook gallery", status: "pending" },
    ],
  },
]

const MODE_META: Record<CollaborationModeMock, {
  label: string
  Icon: ComponentType<{ className?: string }>
}> = {
  spawn: { label: "Spawn", Icon: UserRoundPlus },
  link: { label: "Link", Icon: Link2 },
  handoff: { label: "Handoff", Icon: ArrowRightLeft },
  wait: { label: "Wait", Icon: Clock3 },
}

const STATUS_LABEL: Record<CollaborationStatusMock, string> = {
  pending: "Pending",
  running: "Running",
  waiting: "Waiting",
  complete: "Complete",
  error: "Failed",
}

function HarnessMark({ harness, compact = false }: { harness: CollaborationHarnessMock; compact?: boolean }) {
  const { shortLabel: label } = harnessShowcaseMeta(harness)
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-border/60 bg-background",
        compact ? "size-5" : "size-7",
      )}
      title={label}
      aria-label={label}
    >
      <HarnessSessionIcon
        harness={harness}
        status="default"
        size={compact ? 17 : 21}
        renderLevel="compact"
      />
    </span>
  )
}

function StatusIcon({ status, className }: { status: CollaborationStatusMock; className?: string }) {
  if (status === "complete") {
    return <CheckCircle2 className={cn("size-3.5 shrink-0 text-success", className)} />
  }
  if (status === "running") {
    return <LoaderCircle className={cn("size-3.5 shrink-0 animate-spin text-primary", className)} />
  }
  if (status === "waiting") {
    return <Clock3 className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />
  }
  if (status === "error") {
    return <CircleAlert className={cn("size-3.5 shrink-0 text-error", className)} />
  }
  return <Circle className={cn("size-3.5 shrink-0 text-muted-foreground/60", className)} />
}

function CollaborationEventRow({ event }: { event: CollaborationEventMock }) {
  const status = event.status ?? "complete"
  const { Icon, label } = MODE_META[event.mode]
  const failed = status === "error"

  return (
    <div
      className={cn(
        "tool-node my-0.5 flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-xs",
        failed ? "bg-warning/10" : "bg-muted/20",
      )}
    >
      {failed ? (
        <TriangleAlert className="size-3 shrink-0 text-warning" />
      ) : (
        <Icon className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className={cn("shrink-0 font-medium", failed ? "text-warning" : "text-foreground")}>{label}</span>
      {event.harness && <HarnessMark harness={event.harness} compact />}
      <span className="min-w-0 shrink truncate text-muted-foreground">{event.target}</span>
      {event.summary && <span className="min-w-0 flex-1 truncate text-muted-foreground/70">{event.summary}</span>}
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        <StatusIcon status={status} className="size-3" />
        <span>{STATUS_LABEL[status]}</span>
      </span>
    </div>
  )
}

function SubtaskRow({ subtask }: { subtask: CollaborationSubtaskMock }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <StatusIcon status={subtask.status} className="size-3" />
      <span className="min-w-0 truncate">{subtask.title}</span>
      <span className="ml-auto shrink-0 text-[10px]">{STATUS_LABEL[subtask.status]}</span>
    </li>
  )
}

function AgentCard({
  agent,
  children,
  nested = false,
}: {
  agent: CollaborationAgentMock
  children?: ReactNode
  nested?: boolean
}) {
  return (
    <div className={cn(nested && "ml-4 border-l border-border/60 pl-3")}>
      <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <HarnessMark harness={agent.harness} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-xs font-medium text-foreground">{agent.name}</span>
              <Badge variant="outline">{agent.role}</Badge>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <StatusIcon status={agent.status} />
                {STATUS_LABEL[agent.status]}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{agent.task}</p>
          </div>
        </div>
        {agent.subtasks && agent.subtasks.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5 rounded-md bg-muted/30 px-2 py-1.5">
            {agent.subtasks.map((subtask) => <SubtaskRow key={subtask.id} subtask={subtask} />)}
          </ul>
        )}
      </div>
      {children && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  )
}

function countSubtasks(agents: CollaborationAgentMock[]): number {
  return agents.reduce((total, agent) => total + (agent.subtasks?.length ?? 0), 0)
}

function renderAgentTree(agents: CollaborationAgentMock[], parentId?: string, depth = 0): ReactNode {
  return agents
    .filter((agent) => agent.parentId === parentId)
    .map((agent) => {
      const hasChildren = agents.some((candidate) => candidate.parentId === agent.id)
      return (
        <AgentCard key={agent.id} agent={agent} nested={depth > 0}>
          {hasChildren ? renderAgentTree(agents, agent.id, depth + 1) : undefined}
        </AgentCard>
      )
    })
}

export function CollaborationMock({
  title = "Cross-harness collaboration",
  coordinator = DEFAULT_COORDINATOR,
  agents = DEFAULT_AGENTS,
  events = DEFAULT_EVENTS,
  className,
}: CollaborationMockProps) {
  const runningCount = agents.filter((agent) => agent.status === "running").length
  const completeCount = agents.filter((agent) => agent.status === "complete").length

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}>
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UsersRound className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {agents.length} agents · {countSubtasks(agents)} subtasks
          </p>
        </div>
        <Badge variant="secondary">
          {runningCount > 0 ? `${runningCount} running` : `${completeCount} complete`}
        </Badge>
      </div>

      <div className="flex flex-col gap-4 p-3">
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Network className="size-3" />
            Collaboration activity
          </div>
          <div className="flex flex-col gap-0.5">
            {events.map((event) => <CollaborationEventRow key={event.id} event={event} />)}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessagesSquare className="size-3" />
            Agent tree
          </div>
          <div className="mb-2 flex min-w-0 items-center gap-2 rounded-lg bg-muted/30 p-2">
            <HarnessMark harness={coordinator.harness} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">{coordinator.name}</span>
                <Badge variant="secondary">Coordinator</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{coordinator.task}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">{renderAgentTree(agents)}</div>
        </section>
      </div>
    </div>
  )
}

function tabCountLabel(count: number): string {
  return `${count} ${count === 1 ? "tab" : "tabs"}`
}

export function BrowserCloseResultMock({
  closedTabs = ["Docs", "Preview", "Storybook"],
  failedTabs = [],
  streaming = false,
  className,
}: BrowserCloseResultMockProps) {
  const closedCount = closedTabs.length
  const failedCount = failedTabs.length
  const allFailed = !streaming && failedCount > 0 && closedCount === 0
  const partial = !streaming && failedCount > 0 && closedCount > 0
  const failureTitle = failedTabs.map((failure) => `${failure.tab}: ${failure.reason}`).join("\n")
  const label = streaming
    ? "Closing tabs…"
    : allFailed
      ? "Couldn’t close tabs"
      : `Closed ${tabCountLabel(closedCount)}`
  const summary = streaming
    ? tabCountLabel(closedCount + failedCount)
    : failedCount > 0
      ? `${tabCountLabel(failedCount)} failed`
      : closedTabs.join(" · ")

  return (
    <div
      className={cn(
        "tool-node my-0.5 min-w-0 rounded transition-colors",
        failedCount > 0 ? "bg-warning/10" : "bg-muted/20",
        className,
      )}
      title={failureTitle || undefined}
      aria-label={`${label}${summary ? `, ${summary}` : ""}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs">
        {failedCount > 0 ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <Globe2 className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "shrink-0 font-medium",
            failedCount > 0 ? "text-warning" : "text-foreground",
            streaming && "animate-shimmer",
          )}
        >
          {label}
        </span>
        {summary && <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>}
        {partial && <Badge variant="secondary">Partial</Badge>}
        {allFailed && <Badge variant="destructive">Failed</Badge>}
      </div>
    </div>
  )
}

export type { BrowserCloseFailureMock }
