"use client"

import {
  Fragment,
  useState,
  type ReactNode,
} from "react"
import {
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FileDiff,
  List,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import { MockMarkdown } from "./mock-markdown"
import { ToolBlockMock, type ToolBlockSpec } from "./tool-block-mock"

export interface TurnDetailStatsMock {
  toolCalls: number
  filesChanged: number
  added: number
  removed: number
}

export type TurnDetailRunMock =
  | {
      id: string
      type: "thinking"
      text: string
      label?: string
    }
  | {
      id: string
      type: "tool"
      spec: ToolBlockSpec
      expanded?: boolean
      isStreaming?: boolean
    }
  | {
      id: string
      type: "process"
      label: string
      summary?: string
      status?: "running" | "complete"
    }
  | {
      id: string
      type: "markdown"
      text: string
    }
  | {
      id: string
      type: "widget"
      node: ReactNode
    }

export interface TurnDetailMockProps {
  runs?: TurnDetailRunMock[]
  stats?: TurnDetailStatsMock
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
}

const DEFAULT_STATS: TurnDetailStatsMock = {
  toolCalls: 4,
  filesChanged: 3,
  added: 126,
  removed: 38,
}

function DefaultReadinessWidget() {
  const checks = [
    { label: "Typecheck", value: "Passed", percent: 100 },
    { label: "Scoped tests", value: "18/18", percent: 100 },
    { label: "Visual review", value: "Ready", percent: 86 },
  ]

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <ChartNoAxesColumnIncreasing className="size-3.5 shrink-0 text-primary" />
        <span className="text-xs font-medium">Release readiness</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">94%</span>
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        {checks.map((check) => (
          <div key={check.label} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{check.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary/70"
                style={{ width: `${check.percent}%` }}
              />
            </span>
            <span className="min-w-12 text-right tabular-nums text-foreground">{check.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const DEFAULT_RUNS: TurnDetailRunMock[] = [
  {
    id: "intro",
    type: "markdown",
    text: "I checked the current turn renderer and kept the result aligned with its compact-mode behavior.",
  },
  {
    id: "thinking",
    type: "thinking",
    label: "Thinking",
    text: "The completed turn has enough process segments to collapse. Keep prose and widgets pinned, but preserve the original ordering when Details opens.",
  },
  {
    id: "read",
    type: "tool",
    spec: {
      variant: "read",
      filePath: "apps/desktop/src/renderer/src/components/chat/TurnDetailSection.tsx",
      lineRange: "L1–L190",
      preview: "export function TurnDetailSection({ runs, stats, className }) {\n  // Pinned runs remain visible in compact mode.\n}",
    },
  },
  {
    id: "edit",
    type: "tool",
    spec: {
      variant: "edit",
      filePath: "packages/desktop-mocks/src/desktop/turn-detail-mock.tsx",
      startLine: 118,
      oldText: "return renderTurn(runs)",
      newText: "return renderCompactTurn(runs, stats)",
    },
  },
  {
    id: "typecheck",
    type: "process",
    label: "Typecheck",
    summary: "bunx tsc -p packages/desktop-mocks/tsconfig.json --noEmit",
    status: "complete",
  },
  {
    id: "widget",
    type: "widget",
    node: <DefaultReadinessWidget />,
  },
  {
    id: "answer",
    type: "markdown",
    text: "The mock now keeps this **widget and final answer visible** while thinking, tools, and process output stay behind one Details disclosure.",
  },
]

function isCollapsible(run: TurnDetailRunMock): boolean {
  return run.type === "thinking" || run.type === "tool" || run.type === "process"
}

function formatCount(value: number): string {
  return value.toLocaleString()
}

function DetailStats({ stats }: { stats: TurnDetailStatsMock }) {
  const hasLineDelta = stats.added > 0 || stats.removed > 0

  return (
    <span className="flex items-center gap-1.5 text-[10px] leading-none tabular-nums">
      {stats.toolCalls > 0 && (
        <span className="inline-flex items-center gap-0.5 opacity-70" title={`${stats.toolCalls} tool calls`}>
          <Wrench className="size-2.5" />
          {formatCount(stats.toolCalls)}
        </span>
      )}
      {stats.filesChanged > 0 && (
        <span className="inline-flex items-center gap-0.5 opacity-70" title={`${stats.filesChanged} files changed`}>
          <FileDiff className="size-2.5" />
          {formatCount(stats.filesChanged)}
        </span>
      )}
      {hasLineDelta && (
        <span className="inline-flex items-baseline gap-0.5 font-mono">
          {stats.added > 0 && <span className="text-success/80">+{formatCount(stats.added)}</span>}
          {stats.removed > 0 && <span className="text-error/80">-{formatCount(stats.removed)}</span>}
        </span>
      )}
    </span>
  )
}

function DetailRegion({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!expanded}
      className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
      style={{
        gridTemplateRows: expanded ? "1fr" : "0fr",
        opacity: expanded ? 1 : 0,
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="min-w-0 py-0.5">{children}</div>
      </div>
    </div>
  )
}

function ThinkingRun({ label = "Thinking", text }: { label?: string; text: string }) {
  return (
    <div className="my-0.5 rounded bg-muted/20 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Sparkles className="size-3 shrink-0" />
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <p className="mt-1 leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}

function ProcessRun({
  label,
  summary,
  status = "complete",
}: {
  label: string
  summary?: string
  status?: "running" | "complete"
}) {
  return (
    <div className="my-0.5 flex min-w-0 items-center gap-1.5 rounded bg-muted/20 px-2 py-1.5 text-xs">
      <Terminal className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
      {status === "complete" ? (
        <Check className="ml-auto size-3 shrink-0 text-success" />
      ) : (
        <CircleDashed className="ml-auto size-3 shrink-0 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}

function renderRun(run: TurnDetailRunMock): ReactNode {
  switch (run.type) {
    case "thinking":
      return <ThinkingRun label={run.label} text={run.text} />
    case "tool":
      return (
        <ToolBlockMock
          spec={run.spec}
          expanded={run.expanded}
          isStreaming={run.isStreaming}
        />
      )
    case "process":
      return <ProcessRun label={run.label} summary={run.summary} status={run.status} />
    case "markdown":
      return (
        <div className="my-1 min-w-0 text-sm">
          <MockMarkdown text={run.text} />
        </div>
      )
    case "widget":
      return run.node
  }
}

export function TurnDetailMock({
  runs = DEFAULT_RUNS,
  stats = DEFAULT_STATS,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  className,
}: TurnDetailMockProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const expanded = expandedProp ?? internalExpanded
  const firstCollapsible = runs.findIndex(isCollapsible)

  const setExpanded = (next: boolean) => {
    if (expandedProp === undefined) setInternalExpanded(next)
    onExpandedChange?.(next)
  }

  const indicator = (
    <div className="mb-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "group flex w-full items-center gap-1.5 border-b border-border/50 py-1 text-left text-xs text-muted-foreground/80",
          "transition-colors hover:text-muted-foreground",
        )}
      >
        <List className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate font-normal tracking-wide">Details</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <DetailStats stats={stats} />
          {expanded ? (
            <ChevronDown className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
          ) : (
            <ChevronRight className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      </button>
    </div>
  )

  return (
    <div className={cn("min-w-0", className)}>
      {runs.map((run, index) => (
        <Fragment key={run.id}>
          {index === firstCollapsible && indicator}
          {isCollapsible(run) ? (
            <DetailRegion expanded={expanded}>{renderRun(run)}</DetailRegion>
          ) : (
            renderRun(run)
          )}
        </Fragment>
      ))}
    </div>
  )
}
