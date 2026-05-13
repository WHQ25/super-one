"use client"

import { useMemo, useState, type ReactNode } from "react"
import { diffLines } from "diff"
import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  ClipboardList,
  FileEdit,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  PenLine,
  Plug,
  Search,
  ShieldAlert,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import { ShimmerText } from "./shimmer-text"
import { RollingNumber } from "./rolling-number"
import { inferLanguage, useHighlightedLines, type DiffHLLine } from "./diff-highlight"

function countLinesIgnoringTrailingNewline(text: string): number {
  if (!text) return 0
  const stripped = text.replace(/\n$/, "")
  return stripped.split("\n").length
}

function computeMockLineDelta(
  spec: Exclude<ToolBlockSpec, { variant: "banner" }>,
): { added: number; removed: number } | null {
  switch (spec.variant) {
    case "edit":
    case "notebookEdit": {
      const oldText = spec.variant === "edit" ? spec.oldText : spec.oldSource
      const newText = spec.variant === "edit" ? spec.newText : spec.newSource
      const changes = diffLines(oldText, newText)
      let added = 0
      let removed = 0
      for (const c of changes) {
        const lineCount = countLinesIgnoringTrailingNewline(c.value)
        if (c.added) added += lineCount
        else if (c.removed) removed += lineCount
      }
      return added || removed ? { added, removed } : null
    }
    case "write": {
      const n = countLinesIgnoringTrailingNewline(spec.content)
      return n > 0 ? { added: n, removed: 0 } : null
    }
    case "fileChange": {
      const rows = spec.diff.split("\n")
      if (spec.kind === "add") return { added: rows.length, removed: 0 }
      if (spec.kind === "delete") return { added: 0, removed: rows.length }
      let added = 0
      let removed = 0
      for (const r of rows) {
        if (r.startsWith("+") && !r.startsWith("+++")) added++
        else if (r.startsWith("-") && !r.startsWith("---")) removed++
      }
      return added || removed ? { added, removed } : null
    }
    default:
      return null
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function sliceLinesByProgress(text: string, progress: number): string {
  if (progress >= 1) return text
  if (progress <= 0) return ""
  const total = countLinesIgnoringTrailingNewline(text)
  if (total === 0) return ""
  const visibleLineCount = Math.max(1, Math.floor(total * progress))
  const lines = text.replace(/\n$/, "").split("\n")
  return lines.slice(0, visibleLineCount).join("\n")
}

function sliceDiffByProgress(diff: string, progress: number): string {
  if (progress >= 1) return diff
  if (progress <= 0) return ""
  const rows = diff.split("\n")
  if (rows.length === 0) return ""
  const visible = Math.max(1, Math.floor(rows.length * progress))
  return rows.slice(0, visible).join("\n")
}

export type ToolBlockSpec =
  | {
      variant: "bash"
      command: string
      output?: string
      description?: string
      timeoutMs?: number
      denied?: boolean
      errored?: boolean
    }
  | {
      variant: "edit"
      filePath: string
      oldText: string
      newText: string
      startLine?: number
    }
  | { variant: "read"; filePath: string; lineRange?: string; preview?: string }
  | { variant: "write"; filePath: string; content: string; startLine?: number }
  | {
      variant: "grep"
      pattern: string
      path?: string
      matches?: string
    }
  | {
      variant: "glob"
      pattern: string
      path?: string
      matches?: string
    }
  | {
      variant: "webSearch"
      query: string
      results?: string
    }
  | {
      variant: "webFetch"
      url: string
      preview?: string
    }
  | {
      variant: "task"
      subagent: string
      description?: string
      preview?: string
    }
  | {
      variant: "mcp"
      serverName: string
      toolName: string
      summary?: string
      result?: string
      iconSrc?: string
    }
  | { variant: "skill"; skill: string; preview?: string }
  | { variant: "notebookEdit"; notebookPath: string; oldSource: string; newSource: string }
  | {
      variant: "fileChange"
      filePath: string
      kind: "add" | "delete" | "edit"
      diff: string
    }
  | {
      variant: "askUserQuestion"
      summary?: string
      qa?: Array<{ question: string; answer: string }>
      dismissed?: boolean
    }
  | {
      variant: "banner"
      kind: "enterPlanMode" | "planApproved" | "planRejected" | "planPending"
      feedback?: string
    }
  | { variant: "generic"; tool: string; summary?: string; bodyText?: string; errored?: boolean }

export interface ToolBlockMockProps {
  spec: ToolBlockSpec
  isStreaming?: boolean
  expanded?: boolean
  defaultExpanded?: boolean
  frame?: number
  fps?: number
  expandAtSec?: number
  streamStartFrame?: number
  streamDurationFrames?: number
  className?: string
}

const STREAMING_VERB: Partial<Record<ToolBlockSpec["variant"], string>> = {
  bash: "Running",
  edit: "Editing",
  read: "Reading",
  write: "Writing",
  grep: "Searching",
  glob: "Searching",
  webSearch: "Searching",
  webFetch: "Fetching",
  task: "Delegating",
  mcp: "Calling",
  skill: "Running",
  notebookEdit: "Editing",
  fileChange: "Updating",
  askUserQuestion: "Asking",
  generic: "Running",
}

export function ToolBlockMock({
  spec,
  isStreaming = false,
  expanded: expandedProp,
  defaultExpanded = false,
  frame,
  fps = 30,
  expandAtSec,
  streamStartFrame,
  streamDurationFrames,
  className,
}: ToolBlockMockProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  if (spec.variant === "banner") {
    return <BannerBlock kind={spec.kind} feedback={spec.feedback} />
  }
  const isFrameDriven = frame !== undefined
  let resolvedExpanded: boolean
  if (expandedProp !== undefined) {
    resolvedExpanded = expandedProp
  } else if (isFrameDriven && expandAtSec !== undefined) {
    resolvedExpanded = frame! / fps >= expandAtSec
  } else {
    resolvedExpanded = internalExpanded
  }
  const isControlled = expandedProp !== undefined || (isFrameDriven && expandAtSec !== undefined)

  const fullLineDelta = useMemo(() => computeMockLineDelta(spec), [spec])
  const hasDiffStyleHeader = fullLineDelta !== null

  const streamProgress =
    isStreaming &&
    isFrameDriven &&
    streamStartFrame !== undefined &&
    streamDurationFrames !== undefined &&
    streamDurationFrames > 0
      ? clamp01((frame! - streamStartFrame) / streamDurationFrames)
      : isStreaming
        ? 0
        : 1

  const meta = describeSpec(spec, isStreaming, {
    frame,
    fps,
    streamStartFrame,
    streamProgress,
  })
  const isDenied = meta.denied
  const isError = meta.errored
  const isRunning = isStreaming && !isDenied && !isError
  const runningLabel = STREAMING_VERB[spec.variant] ?? "Running"
  const showShimmerLabel = isRunning && !hasDiffStyleHeader
  const elapsedSec =
    isRunning && isFrameDriven && streamStartFrame !== undefined
      ? Math.max(0, Math.floor((frame! - streamStartFrame) / fps))
      : 0
  const lineDelta =
    fullLineDelta && isRunning
      ? {
          added: Math.round(fullLineDelta.added * streamProgress),
          removed: Math.round(fullLineDelta.removed * streamProgress),
        }
      : fullLineDelta

  return (
    <div
      className={cn(
        "tool-node my-0.5 rounded transition-colors",
        isDenied
          ? "denied bg-red-500/10 hover:bg-red-500/20"
          : isError
            ? "errored bg-amber-500/10 hover:bg-amber-500/20"
            : "bg-muted/50 hover:bg-muted/70",
        meta.body && "cursor-pointer",
        resolvedExpanded && "overflow-hidden",
        className,
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => {
          if (!isControlled && meta.body) setInternalExpanded((v) => !v)
        }}
      >
        <span
          className={cn(
            "size-3 shrink-0",
            isDenied
              ? "text-red-600 dark:text-red-400"
              : isError
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          {isDenied ? <Ban className="size-3" /> : isError ? <TriangleAlert className="size-3" /> : meta.icon}
        </span>
        <span
          className={cn(
            "font-medium shrink-0",
            isDenied
              ? "text-red-600 dark:text-red-400"
              : isError
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground",
          )}
        >
          {showShimmerLabel ? (
            <ShimmerText frame={frame} fps={fps}>{`${runningLabel}…`}</ShimmerText>
          ) : (
            meta.tool
          )}
        </span>
        {meta.summary && (
          <span className="min-w-0 truncate text-muted-foreground">{meta.summary}</span>
        )}
        {lineDelta && (lineDelta.added > 0 || lineDelta.removed > 0) && (
          <span className="shrink-0 font-mono text-[11px]">
            {lineDelta.added > 0 && (
              <span className="inline-flex items-baseline text-green-600 dark:text-green-400">
                +<RollingNumber value={lineDelta.added} frame={frame} />
              </span>
            )}
            {lineDelta.added > 0 && lineDelta.removed > 0 && (
              <span className="text-muted-foreground/50"> </span>
            )}
            {lineDelta.removed > 0 && (
              <span className="inline-flex items-baseline text-red-600 dark:text-red-400">
                -<RollingNumber value={lineDelta.removed} frame={frame} />
              </span>
            )}
          </span>
        )}
        {isRunning && elapsedSec >= 1 && (
          <span className="shrink-0 text-muted-foreground tabular-nums">{elapsedSec}s</span>
        )}
        {meta.badge && (
          <span className={cn("shrink-0 rounded px-1 py-px text-[10px]", meta.badge.className)}>
            {meta.badge.text}
          </span>
        )}
        {isDenied && (
          <span className="shrink-0 rounded bg-red-500/20 px-1 py-px text-[10px] text-red-600 dark:text-red-400">
            Denied
          </span>
        )}
        {meta.body && (
          <ChevronRight
            className={cn(
              "ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200",
              resolvedExpanded && "rotate-90",
            )}
          />
        )}
      </div>
      {resolvedExpanded && meta.body}
    </div>
  )
}

interface SpecMeta {
  icon: ReactNode
  tool: ReactNode
  summary?: string
  body?: ReactNode
  denied?: boolean
  errored?: boolean
  badge?: { text: string; className: string }
}

function describeSpec(
  spec: Exclude<ToolBlockSpec, { variant: "banner" }>,
  isStreaming: boolean,
  shimmerCtx: {
    frame?: number
    fps: number
    streamStartFrame?: number
    streamProgress: number
  },
): SpecMeta {
  const progress = isStreaming ? shimmerCtx.streamProgress : 1
  switch (spec.variant) {
    case "bash":
      return {
        icon: <Terminal className="size-3" />,
        tool: "Bash",
        summary: spec.description ?? spec.command,
        body: (
          <BashBody
            command={spec.command}
            output={spec.output}
            isStreaming={isStreaming}
            frame={shimmerCtx.frame}
            fps={shimmerCtx.fps}
            streamStartFrame={shimmerCtx.streamStartFrame}
          />
        ),
        denied: spec.denied,
        errored: spec.errored,
        badge: spec.timeoutMs
          ? { text: `${Math.round(spec.timeoutMs / 1000)}s`, className: "bg-muted text-muted-foreground" }
          : undefined,
      }
    case "edit":
      return {
        icon: <FileEdit className="size-3" />,
        tool: "Edit",
        summary: spec.filePath,
        body: (
          <EditDiffBody
            oldText={spec.oldText}
            newText={sliceLinesByProgress(spec.newText, progress)}
            startLine={spec.startLine ?? 1}
            filePath={spec.filePath}
            isStreaming={isStreaming}
          />
        ),
      }
    case "read":
      return {
        icon: <FileText className="size-3" />,
        tool: "Read",
        summary: spec.lineRange ? `${spec.filePath} (${spec.lineRange})` : spec.filePath,
        body: spec.preview ? <ResultBody text={spec.preview} /> : undefined,
      }
    case "write":
      return {
        icon: <FilePlus2 className="size-3" />,
        tool: "Write",
        summary: spec.filePath,
        body: (
          <EditDiffBody
            oldText=""
            newText={sliceLinesByProgress(spec.content, progress)}
            startLine={spec.startLine ?? 1}
            filePath={spec.filePath}
            isStreaming={isStreaming}
          />
        ),
      }
    case "grep":
      return {
        icon: <Search className="size-3" />,
        tool: "Grep",
        summary: `${spec.pattern}${spec.path ? ` in ${spec.path}` : ""}`,
        body: spec.matches ? <ResultBody text={spec.matches} /> : undefined,
      }
    case "glob":
      return {
        icon: <FolderSearch className="size-3" />,
        tool: "Glob",
        summary: `${spec.pattern}${spec.path ? ` in ${spec.path}` : ""}`,
        body: spec.matches ? <ResultBody text={spec.matches} /> : undefined,
      }
    case "webSearch":
      return {
        icon: <Globe className="size-3" />,
        tool: "WebSearch",
        summary: spec.query,
        body: spec.results ? <ResultBody text={spec.results} /> : undefined,
      }
    case "webFetch":
      return {
        icon: <Globe className="size-3" />,
        tool: "WebFetch",
        summary: spec.url,
        body: spec.preview ? <ResultBody text={spec.preview} /> : undefined,
      }
    case "task":
      return {
        icon: <Bot className="size-3" />,
        tool: "Task",
        summary: spec.description ?? spec.subagent,
        body: spec.preview ? <ResultBody text={spec.preview} /> : undefined,
      }
    case "mcp":
      return {
        icon: spec.iconSrc ? (
          <img src={spec.iconSrc} alt={spec.serverName} className="size-3.5 rounded-sm object-cover" />
        ) : (
          <Plug className="size-3" />
        ),
        tool: (
          <>
            {spec.serverName}
            <span className="text-muted-foreground"> · </span>
            {spec.toolName}
          </>
        ),
        summary: spec.summary,
        body: spec.result ? <JsonBody text={spec.result} /> : undefined,
      }
    case "skill":
      return {
        icon: <Wrench className="size-3" />,
        tool: "Skill",
        summary: spec.skill,
        body: spec.preview ? <ResultBody text={spec.preview} /> : undefined,
      }
    case "notebookEdit":
      return {
        icon: <FilePlus2 className="size-3" />,
        tool: "NotebookEdit",
        summary: spec.notebookPath,
        body: (
          <EditDiffBody
            oldText={spec.oldSource}
            newText={sliceLinesByProgress(spec.newSource, progress)}
            startLine={1}
            filePath={spec.notebookPath}
            isStreaming={isStreaming}
          />
        ),
      }
    case "fileChange":
      return {
        icon: <FileEdit className="size-3" />,
        tool: "FileChange",
        summary: `${spec.filePath} · ${spec.kind}`,
        body: (
          <FileChangeBody
            diff={sliceDiffByProgress(spec.diff, progress)}
            kind={spec.kind}
            filePath={spec.filePath}
            isStreaming={isStreaming}
          />
        ),
      }
    case "askUserQuestion":
      return {
        icon: <ClipboardList className="size-3" />,
        tool: spec.dismissed ? "AskUserQuestion" : `Asked ${spec.summary ?? ""}`.trim(),
        summary: spec.dismissed ? spec.summary : undefined,
        badge: spec.dismissed
          ? { text: "dismissed", className: "bg-muted text-muted-foreground" }
          : undefined,
        body: spec.qa && spec.qa.length > 0 ? <QABody pairs={spec.qa} /> : undefined,
      }
    case "generic":
      return {
        icon: <Wrench className="size-3" />,
        tool: spec.tool,
        summary: spec.summary,
        body: spec.bodyText ? <ResultBody text={spec.bodyText} /> : undefined,
        errored: spec.errored,
      }
  }
}

function BannerBlock({
  kind,
  feedback,
}: {
  kind: "enterPlanMode" | "planApproved" | "planRejected" | "planPending"
  feedback?: string
}) {
  if (kind === "enterPlanMode") {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="font-medium text-blue-600 dark:text-blue-400">Entered plan mode</span>
      </div>
    )
  }
  if (kind === "planPending") {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Review Plan</span>
      </div>
    )
  }
  if (kind === "planApproved") {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-green-500/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-green-600 dark:text-green-400" />
        <span className="font-medium text-green-600 dark:text-green-400">Plan Approved</span>
        <Check className="ml-auto size-3 shrink-0 text-green-600 dark:text-green-400" />
      </div>
    )
  }
  return (
    <div className="my-4 rounded bg-red-500/10 px-2 py-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <PenLine className="size-3 shrink-0 text-red-600 dark:text-red-400" />
        <span className="font-medium text-red-600 dark:text-red-400">Plan Rejected</span>
        <X className="ml-auto size-3 shrink-0 text-red-600 dark:text-red-400" />
      </div>
      {feedback && (
        <div className="mt-1 text-xs text-red-600/70 dark:text-red-400/70">{feedback}</div>
      )}
    </div>
  )
}

function BashBody({
  command,
  output,
  isStreaming,
  frame,
  fps,
  streamStartFrame,
}: {
  command: string
  output?: string
  isStreaming: boolean
  frame?: number
  fps: number
  streamStartFrame?: number
}) {
  const elapsedSec =
    isStreaming && frame !== undefined && streamStartFrame !== undefined
      ? Math.max(0, Math.floor((frame - streamStartFrame) / fps))
      : 0
  return (
    <div className="bg-[#0d1117] font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
      {command && (
        <div className="px-3 pt-2 text-[#e6edf3]">
          <span className="text-[#7ee787]">$ </span>
          {command}
        </div>
      )}
      <div className="max-h-32 overflow-y-auto overflow-x-auto px-3 py-1.5">
        {output ? (
          <div className="text-[#8b949e]">{output}</div>
        ) : isStreaming ? (
          <div className="text-[#8b949e]">
            <ShimmerText frame={frame} fps={fps}>Running…</ShimmerText>
            {elapsedSec >= 1 && (
              <span className="text-[#6e7681]"> {elapsedSec}s</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface DiffRow {
  kind: "added" | "removed" | "unchanged"
  lineNum: number
  text: string
  oldIdx?: number
  newIdx?: number
}

function buildUnifiedDiffRows(oldText: string, newText: string, startLine: number): DiffRow[] {
  if (!oldText && !newText) return []
  const changes = diffLines(oldText, newText)
  const result: DiffRow[] = []
  let oldLine = startLine
  let newLine = startLine
  let oldIdx = 0
  let newIdx = 0
  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n")
    if (change.removed) {
      for (const text of lines) {
        result.push({ kind: "removed", lineNum: oldLine++, text, oldIdx: oldIdx++ })
      }
    } else if (change.added) {
      for (const text of lines) {
        result.push({ kind: "added", lineNum: newLine++, text, newIdx: newIdx++ })
      }
    } else {
      for (const text of lines) {
        result.push({ kind: "unchanged", lineNum: newLine, text, oldIdx: oldIdx++, newIdx: newIdx++ })
        oldLine++
        newLine++
      }
    }
  }
  return result
}

function buildFileChangeRows(diff: string, kind: "add" | "delete" | "edit"): DiffRow[] {
  const rows = diff.split("\n")
  if (kind === "add") {
    return rows.map((text, i) => ({ kind: "added" as const, lineNum: i + 1, text, newIdx: i }))
  }
  if (kind === "delete") {
    return rows.map((text, i) => ({ kind: "removed" as const, lineNum: i + 1, text, oldIdx: i }))
  }
  const result: DiffRow[] = []
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0
  for (const row of rows) {
    if (row.startsWith("+") && !row.startsWith("+++")) {
      result.push({ kind: "added", lineNum: newLine++, text: row.slice(1), newIdx: newIdx++ })
    } else if (row.startsWith("-") && !row.startsWith("---")) {
      result.push({ kind: "removed", lineNum: oldLine++, text: row.slice(1), oldIdx: oldIdx++ })
    } else {
      const text = row.startsWith(" ") ? row.slice(1) : row
      result.push({ kind: "unchanged", lineNum: newLine, text, oldIdx: oldIdx++, newIdx: newIdx++ })
      oldLine++
      newLine++
    }
  }
  return result
}

const DIFF_ROW_BG: Record<DiffRow["kind"], string> = {
  added: "bg-green-500/15",
  removed: "bg-red-500/15",
  unchanged: "",
}

const DIFF_MARKER_CLS: Record<DiffRow["kind"], string> = {
  added: "text-green-600/60 dark:text-green-400/60",
  removed: "text-red-600/60 dark:text-red-400/60",
  unchanged: "text-transparent",
}

const DIFF_MARKER: Record<DiffRow["kind"], string> = {
  added: "+",
  removed: "-",
  unchanged: " ",
}

function HighlightedLineContent({ tokens }: { tokens: DiffHLLine }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span
          key={i}
          style={
            (t.color || t.bgColor || t.htmlStyle
              ? { color: t.color, backgroundColor: t.bgColor, ...(t.htmlStyle ?? {}) }
              : undefined) as React.CSSProperties | undefined
          }
        >
          {t.content}
        </span>
      ))}
    </>
  )
}

function DiffRows({
  rows,
  oldHL,
  newHL,
  isStreaming,
}: {
  rows: DiffRow[]
  oldHL?: DiffHLLine[] | null
  newHL?: DiffHLLine[] | null
  isStreaming?: boolean
}) {
  const maxLine = rows.reduce((m, r) => Math.max(m, r.lineNum), 0)
  const gw = Math.max(2, String(maxLine).length)
  if (rows.length === 0) return null
  const lastAddedIdx = isStreaming
    ? (() => {
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === "added") return i
        return -1
      })()
    : -1
  return (
    <div className="overflow-auto rounded bg-background/70 py-2 text-[11px] font-mono leading-relaxed text-foreground max-h-[300px]">
      {rows.map((row, i) => {
        const hlTokens =
          row.kind === "removed"
            ? row.oldIdx != null ? oldHL?.[row.oldIdx] : undefined
            : row.newIdx != null ? newHL?.[row.newIdx] : undefined
        const showCursor = i === lastAddedIdx
        return (
          <div key={i} className={cn("whitespace-pre pr-2", DIFF_ROW_BG[row.kind])}>
            <span
              className="sticky left-0 z-10 inline-block select-none bg-background pl-2 pr-1 text-right text-muted-foreground/50"
              style={{ width: `calc(${gw}ch + 0.75rem)` }}
            >
              {row.lineNum}
            </span>
            <span
              className={cn(
                "mr-1 inline-block w-[1ch] select-none text-center",
                DIFF_MARKER_CLS[row.kind],
              )}
            >
              {DIFF_MARKER[row.kind]}
            </span>
            {hlTokens && hlTokens.length > 0
              ? <HighlightedLineContent tokens={hlTokens} />
              : (row.text || " ")}
            {showCursor && (
              <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-primary align-middle animate-pulse" />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function EditDiffBody({
  oldText,
  newText,
  startLine,
  filePath,
  isStreaming,
}: {
  oldText: string
  newText: string
  startLine: number
  filePath?: string
  isStreaming?: boolean
}) {
  const rows = useMemo(
    () => buildUnifiedDiffRows(oldText, newText, startLine),
    [oldText, newText, startLine],
  )
  const language = useMemo(() => inferLanguage(filePath ?? ""), [filePath])
  const oldHL = useHighlightedLines(oldText, language)
  const newHL = useHighlightedLines(newText, language)
  return <DiffRows rows={rows} oldHL={oldHL} newHL={newHL} isStreaming={isStreaming} />
}

function FileChangeBody({
  diff,
  kind,
  filePath,
  isStreaming,
}: {
  diff: string
  kind: "add" | "delete" | "edit"
  filePath?: string
  isStreaming?: boolean
}) {
  const rows = useMemo(() => buildFileChangeRows(diff, kind), [diff, kind])
  const { oldText, newText } = useMemo(() => {
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const r of rows) {
      if (r.kind === "added") newLines.push(r.text)
      else if (r.kind === "removed") oldLines.push(r.text)
      else {
        oldLines.push(r.text)
        newLines.push(r.text)
      }
    }
    return { oldText: oldLines.join("\n"), newText: newLines.join("\n") }
  }, [rows])
  const language = useMemo(() => inferLanguage(filePath ?? ""), [filePath])
  const oldHL = useHighlightedLines(oldText, language)
  const newHL = useHighlightedLines(newText, language)
  return <DiffRows rows={rows} oldHL={oldHL} newHL={newHL} isStreaming={isStreaming} />
}

function ResultBody({ text }: { text: string }) {
  return (
    <div className="px-2 pb-1.5">
      <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-48">
        {text}
      </div>
    </div>
  )
}

function JsonBody({ text }: { text: string }) {
  let pretty = text
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2)
  } catch {}
  return (
    <div className="px-2 pb-1.5">
      <div className="overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre max-h-64">
        {pretty}
      </div>
    </div>
  )
}

function QABody({ pairs }: { pairs: Array<{ question: string; answer: string }> }) {
  return (
    <div className="space-y-1 px-2 pb-1.5">
      {pairs.map((p, i) => (
        <div key={i} className="rounded bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed">
          <div className="text-muted-foreground">{p.question}</div>
          <div className="text-green-600 dark:text-green-400">{p.answer}</div>
        </div>
      ))}
    </div>
  )
}

export function SandboxNetworkBanner({ host }: { host: string }) {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs">
      <ShieldAlert className="size-3 shrink-0 text-amber-500" />
      <span className="font-medium text-amber-500">Sandbox network</span>
      <span className="font-mono text-muted-foreground">{host}</span>
    </div>
  )
}
