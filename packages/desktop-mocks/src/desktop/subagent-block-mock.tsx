"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  MessageSquare,
  Sparkles,
  Wrench,
} from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import { useMockT } from "./i18n"
import { ShimmerText } from "./shimmer-text"
import { ToolBlockMock, type ToolBlockSpec } from "./tool-block-mock"

export const SUBAGENT_COLOR_POOL = [
  "purple",
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "rose",
] as const

export type SubagentColorName = (typeof SUBAGENT_COLOR_POOL)[number]

interface SubagentColorClasses {
  text: string
  tagBg: string
  tagText: string
  activityBg: string
  borderL: string
}

const SUBAGENT_COLOR_CLASSES: Record<SubagentColorName, SubagentColorClasses> = {
  purple: {
    text: "text-purple-600 dark:text-purple-400",
    tagBg: "bg-purple-500/15 dark:bg-purple-900/40",
    tagText: "text-purple-700 dark:text-purple-300",
    activityBg: "bg-purple-500/10 dark:bg-purple-900/20",
    borderL: "border-purple-500/30",
  },
  blue: {
    text: "text-blue-600 dark:text-blue-400",
    tagBg: "bg-blue-500/15 dark:bg-blue-900/40",
    tagText: "text-blue-700 dark:text-blue-300",
    activityBg: "bg-blue-500/10 dark:bg-blue-900/20",
    borderL: "border-blue-500/30",
  },
  cyan: {
    text: "text-cyan-600 dark:text-cyan-400",
    tagBg: "bg-cyan-500/15 dark:bg-cyan-900/40",
    tagText: "text-cyan-700 dark:text-cyan-300",
    activityBg: "bg-cyan-500/10 dark:bg-cyan-900/20",
    borderL: "border-cyan-500/30",
  },
  teal: {
    text: "text-teal-600 dark:text-teal-400",
    tagBg: "bg-teal-500/15 dark:bg-teal-900/40",
    tagText: "text-teal-700 dark:text-teal-300",
    activityBg: "bg-teal-500/10 dark:bg-teal-900/20",
    borderL: "border-teal-500/30",
  },
  green: {
    text: "text-green-600 dark:text-green-400",
    tagBg: "bg-green-500/15 dark:bg-green-900/40",
    tagText: "text-green-700 dark:text-green-300",
    activityBg: "bg-green-500/10 dark:bg-green-900/20",
    borderL: "border-green-500/30",
  },
  amber: {
    text: "text-amber-600 dark:text-amber-400",
    tagBg: "bg-amber-500/15 dark:bg-amber-900/40",
    tagText: "text-amber-700 dark:text-amber-300",
    activityBg: "bg-amber-500/10 dark:bg-amber-900/20",
    borderL: "border-amber-500/30",
  },
  orange: {
    text: "text-orange-600 dark:text-orange-400",
    tagBg: "bg-orange-500/15 dark:bg-orange-900/40",
    tagText: "text-orange-700 dark:text-orange-300",
    activityBg: "bg-orange-500/10 dark:bg-orange-900/20",
    borderL: "border-orange-500/30",
  },
  rose: {
    text: "text-rose-600 dark:text-rose-400",
    tagBg: "bg-rose-500/15 dark:bg-rose-900/40",
    tagText: "text-rose-700 dark:text-rose-300",
    activityBg: "bg-rose-500/10 dark:bg-rose-900/20",
    borderL: "border-rose-500/30",
  },
}

const DEFAULT_COLOR: SubagentColorName = "purple"

export interface SubagentChildToolMock {
  spec: ToolBlockSpec
  expanded?: boolean
  isStreaming?: boolean
}

export interface SubagentAsyncToolMock {
  toolName: string
  description?: string
  isActive?: boolean
}

export type SubagentBlockState = "spawning" | "running" | "complete"

export interface SubagentBlockMockProps {
  /** Visual color taken from the subagent color pool. Default: purple. */
  color?: SubagentColorName
  /** Lifecycle state — `spawning` shows placeholder, `running` animates, `complete` shows ✓ */
  state?: SubagentBlockState
  /** Whether the body is expanded (header always visible). Default: depends on state */
  expanded?: boolean
  /** Background subagents render with a "Running in background" footer */
  async?: boolean
  /** subagent_type tag (e.g. "general-purpose", "code-reviewer") */
  subagentType?: string
  /** Short label shown next to the tag */
  description?: string
  /** Long prompt shown under the "Prompt" disclosure */
  prompt?: string
  /** Optional model badge shown beside the prompt label */
  model?: string
  /** Whether the prompt disclosure is open */
  promptExpanded?: boolean
  /** Whether the output disclosure is open */
  outputExpanded?: boolean
  /** Final markdown shown under the "Output" disclosure */
  resultText?: string
  /** Async subagent live status line ("Running integration test suite (3/12)") */
  liveActivityText?: string
  /** Sub-tool calls (rendered as ToolBlockMock entries inside the colored scroll area) */
  childTools?: SubagentChildToolMock[]
  /** Async-mode tool history (rendered as compact rows; used when childTools is empty) */
  asyncToolHistory?: SubagentAsyncToolMock[]
  /** Optional summary card shown above the activity row (Sparkles icon, blue tint) */
  summary?: string
  /** Footer elapsed-seconds value */
  elapsedSec?: number
  /** Footer token counts. If both 0 they're hidden. */
  inputTokens?: number
  outputTokens?: number
  /** Footer total-tokens (async progress) */
  totalTokens?: number
  /** Footer tool-call count override; falls back to childTools.length / asyncToolHistory.length */
  toolCallCount?: number
  /** Frame-driven shimmer support */
  frame?: number
  fps?: number
  className?: string
}

function formatTokensCompact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export function SubagentBlockMock({
  color = DEFAULT_COLOR,
  state = "complete",
  expanded,
  async: isAsync = false,
  subagentType,
  description,
  prompt,
  model,
  promptExpanded = false,
  outputExpanded = false,
  resultText,
  liveActivityText,
  childTools = [],
  asyncToolHistory = [],
  summary,
  elapsedSec = 0,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  toolCallCount,
  frame,
  fps = 30,
  className,
}: SubagentBlockMockProps) {
  const t = useMockT()
  const colors = SUBAGENT_COLOR_CLASSES[color] ?? SUBAGENT_COLOR_CLASSES[DEFAULT_COLOR]
  const isRunning = state === "running"
  const isSpawning = state === "spawning"
  const isComplete = state === "complete"
  const resolvedExpanded = expanded ?? (isAsync ? state !== "spawning" : !isComplete)

  const resolvedToolCount =
    toolCallCount ??
    (childTools.length > 0 ? childTools.length : asyncToolHistory.length)

  const hasTokens = inputTokens > 0 || outputTokens > 0

  return (
    <div
      className={cn(
        "subagent-container my-1 overflow-hidden rounded border border-border/50 bg-muted/20",
        className,
      )}
    >
      <div className="flex w-full items-center gap-2 px-2.5 py-2 text-xs">
        <Bot
          className={cn(
            "size-3.5 shrink-0",
            colors.text,
            isRunning && !resolvedExpanded && "animate-pulse",
          )}
        />
        {subagentType && (
          <span className={cn("shrink-0 rounded px-1 py-px text-[10px]", colors.tagBg, colors.tagText)}>
            {subagentType}
          </span>
        )}
        {description && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{description}</span>
        )}
        {isSpawning && !description && (
          <span className="min-w-0 text-left text-muted-foreground">{t("chat.subagent.spawning")}</span>
        )}
        <ChevronRight
          className={cn(
            "ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200",
            resolvedExpanded && "rotate-90",
          )}
        />
      </div>

      {resolvedExpanded && (
        <div className="border-t border-border/30">
          {prompt && <PromptPreview prompt={prompt} model={model} expanded={promptExpanded} />}

          {isAsync && (asyncToolHistory.length > 0 || liveActivityText || summary) && (
            <AgentActivity
              tools={asyncToolHistory}
              isRunning={isRunning}
              liveActivityText={liveActivityText}
              summary={summary}
              colors={colors}
            />
          )}

          {childTools.length > 0 && (
            <SubagentScrollArea borderClass={colors.borderL}>
              {childTools.map((child, i) => (
                <ToolBlockMock
                  key={i}
                  spec={child.spec}
                  isStreaming={child.isStreaming}
                  defaultExpanded={child.expanded ?? false}
                  frame={frame}
                  fps={fps}
                />
              ))}
            </SubagentScrollArea>
          )}

          {resultText && !(isAsync && isRunning) && (
            <OutputPreview text={resultText} expanded={outputExpanded} />
          )}
        </div>
      )}

      {resolvedExpanded && (isRunning || isComplete) && (
        <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {isRunning ? (
            <>
              <span>
                {isAsync ? (
                  <ShimmerText frame={frame} fps={fps}>{t("chat.subagent.runningInBackground")}</ShimmerText>
                ) : (
                  <ShimmerText frame={frame} fps={fps}>{t("chat.subagent.running")}</ShimmerText>
                )}
              </span>
              {elapsedSec > 0 && (
                <span className="tabular-nums">{formatElapsed(elapsedSec)}</span>
              )}
            </>
          ) : (
            <>
              <Check className="size-3 shrink-0 text-green-600 dark:text-green-400" />
              <span>
                {t("chat.subagent.done")}
                {elapsedSec > 0 ? ` ${formatElapsed(elapsedSec)}` : ""}
              </span>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {isAsync ? (
              <>
                {resolvedToolCount > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <Wrench className="size-3" />
                    {resolvedToolCount}
                  </span>
                )}
                {totalTokens > 0 && (
                  <>
                    {resolvedToolCount > 0 && <span>·</span>}
                    <span className="tabular-nums">{formatTokensCompact(totalTokens)}</span>
                  </>
                )}
              </>
            ) : (
              <>
                {resolvedToolCount > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <Wrench className="size-3" />
                    {resolvedToolCount}
                  </span>
                )}
                {hasTokens && resolvedToolCount > 0 && <span>·</span>}
                {inputTokens > 0 && (
                  <span className="inline-flex items-center gap-0.5 tabular-nums">
                    <ArrowUp className="size-2.5" />
                    {formatTokensCompact(inputTokens)}
                  </span>
                )}
                {outputTokens > 0 && (
                  <span className="inline-flex items-center gap-0.5 tabular-nums">
                    <ArrowDown className="size-2.5" />
                    {formatTokensCompact(outputTokens)}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function PromptPreview({
  prompt,
  model,
  expanded,
}: {
  prompt: string
  model?: string
  expanded: boolean
}) {
  const t = useMockT()
  return (
    <div className="px-3 py-1.5 text-[11px]">
      <div className="flex items-center gap-1 text-muted-foreground">
        <ChevronRight
          className={cn(
            "size-2.5 shrink-0 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <span>{t("chat.subagent.prompt")}</span>
        {model && (
          <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">{model}</span>
        )}
      </div>
      {expanded && (
        <div className="mt-1 max-h-[100px] overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 leading-relaxed text-muted-foreground">
          {prompt}
        </div>
      )}
    </div>
  )
}

function OutputPreview({ text, expanded }: { text: string; expanded: boolean }) {
  const t = useMockT()
  return (
    <div className="border-t border-border/30 px-3 py-1.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <ChevronRight
          className={cn(
            "size-2.5 shrink-0 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <span className="font-medium">{t("chat.subagent.output")}</span>
      </div>
      {expanded && (
        <div className="mt-1 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 text-xs leading-relaxed text-foreground">
          {text}
        </div>
      )}
    </div>
  )
}

function SubagentScrollArea({
  children,
  borderClass,
}: {
  children: ReactNode
  borderClass: string
}) {
  return (
    <div
      className={cn(
        "max-h-[180px] overflow-y-auto border-l-2 ml-3 pl-2.5 py-1",
        borderClass,
      )}
    >
      {children}
    </div>
  )
}

function AgentActivity({
  tools,
  liveActivityText,
  summary,
  isRunning,
  colors,
}: {
  tools: SubagentAsyncToolMock[]
  liveActivityText?: string
  summary?: string
  isRunning: boolean
  colors: SubagentColorClasses
}) {
  const renderedTools = useMemo(() => tools, [tools])
  return (
    <div className="border-t border-border/30">
      {summary && (
        <div className="mx-2.5 mt-1.5 mb-1.5 flex items-start gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-foreground dark:bg-blue-900/20">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="whitespace-pre-wrap">{summary}</span>
        </div>
      )}
      {isRunning && liveActivityText && (
        <div
          className={cn(
            "mx-2.5 mt-1.5 mb-1.5 flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs leading-relaxed text-foreground",
            colors.activityBg,
          )}
        >
          <MessageSquare
            className={cn("mt-0.5 size-3 shrink-0 animate-pulse", colors.text)}
          />
          <span className="whitespace-pre-wrap">{liveActivityText}</span>
        </div>
      )}
      {renderedTools.length > 0 && (
        <SubagentScrollArea borderClass={colors.borderL}>
          {renderedTools.map((entry, i) => (
            <AsyncToolRow
              key={i}
              toolName={entry.toolName}
              description={entry.description}
              isActive={!!entry.isActive}
            />
          ))}
        </SubagentScrollArea>
      )}
    </div>
  )
}

function AsyncToolRow({
  toolName,
  description,
  isActive,
}: {
  toolName: string
  description?: string
  isActive: boolean
}) {
  return (
    <div className="tool-node my-0.5 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs">
      <Wrench className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium text-foreground">
        {isActive ? `${toolName}…` : toolName}
      </span>
      {description && (
        <span className="min-w-0 truncate text-muted-foreground">{description}</span>
      )}
    </div>
  )
}
