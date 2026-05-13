"use client"

import { type ReactNode } from "react"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  FileEdit,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  Plug,
  Search,
  ShieldAlert,
  Terminal,
  Wrench,
} from "lucide-react"
import { Button } from "@superone/ui/components/ui/button"
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"
import { EditDiffBody, type ToolBlockSpec } from "./tool-block-mock"

export type PermissionAction = "allow" | "always_allow" | "deny" | "decline" | "cancel"

export type PermissionMode = "default" | "codex_decision" | "sandbox_network" | "elicitation"

export interface ElicitationField {
  name: string
  label: string
  type: "string" | "number" | "boolean"
  value?: string | number | boolean
  placeholder?: string
}

export interface PermissionSuggestion {
  label: string
  selected?: boolean
}

export interface PermissionPromptMockProps {
  spec?: ToolBlockSpec
  mode?: PermissionMode
  description?: string
  decisionReason?: string
  feedbackPlaceholder?: string
  focusedAction?: PermissionAction
  sandboxNetwork?: { host: string }
  elicitation?: {
    serverName: string
    message: string
    subtitle?: string
    riskLevel?: "low" | "medium" | "high"
    fields?: ElicitationField[]
  }
  suggestions?: PermissionSuggestion[]
  blockedPath?: string
  dangerouslyDisableSandbox?: boolean
  className?: string
}

export function PermissionPromptMock({
  spec,
  mode = "default",
  description,
  decisionReason,
  feedbackPlaceholder = "Tell Claude what to do differently",
  focusedAction = "allow",
  sandboxNetwork,
  elicitation,
  suggestions,
  blockedPath,
  dangerouslyDisableSandbox = false,
  className,
}: PermissionPromptMockProps) {
  if (mode === "sandbox_network" && sandboxNetwork) {
    return (
      <div className={cn("@container mx-3 mb-2", className)}>
        <div className="rounded-lg border border-border bg-muted/60 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
              <span className="font-medium text-amber-500">Allow sandbox network</span>
            </div>
            <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3.5" />
            </button>
          </div>
          <p className="mb-2 font-mono text-xs text-muted-foreground">{sandboxNetwork.host}</p>
          {decisionReason && (
            <p className="mb-2 text-xs text-muted-foreground">{decisionReason}</p>
          )}
          <DefaultActions focusedAction={focusedAction} feedbackPlaceholder={feedbackPlaceholder} />
        </div>
      </div>
    )
  }

  if (mode === "elicitation" && elicitation) {
    const riskColor =
      elicitation.riskLevel === "high"
        ? "text-red-500"
        : elicitation.riskLevel === "medium"
          ? "text-amber-500"
          : "text-muted-foreground"
    return (
      <div className={cn("@container mx-3 mb-2", className)}>
        <div className="rounded-lg border border-border bg-muted/60 p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", riskColor)} />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">
                  {elicitation.serverName} · {elicitation.message}
                </div>
                {elicitation.subtitle && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {elicitation.subtitle}
                  </p>
                )}
              </div>
            </div>
            <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3.5" />
            </button>
          </div>
          {elicitation.fields && elicitation.fields.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {elicitation.fields.map((f) => (
                <div key={f.name} className="flex items-center gap-2">
                  <label className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">
                    {f.label}
                  </label>
                  <div className="min-w-0 flex-1">
                    {f.type === "boolean" ? (
                      <div
                        className={cn(
                          "inline-flex h-5 w-9 items-center rounded-full px-0.5",
                          f.value ? "justify-end bg-emerald-500/60" : "justify-start bg-muted",
                        )}
                      >
                        <span className="size-4 rounded-full bg-background" />
                      </div>
                    ) : (
                      <div className="flex h-7 w-full items-center rounded bg-background/70 px-2 text-xs text-foreground">
                        {String(f.value ?? "")}
                        {!f.value && (
                          <span className="text-muted-foreground">{f.placeholder ?? ""}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
            <ActionPill color="green" label="Allow" focused={focusedAction === "allow"} />
            <ActionPill color="blue" label="Always allow" focused={focusedAction === "always_allow"} />
            <ActionPill color="red" label="Decline" focused={focusedAction === "decline"} />
            <ActionPill color="ghost" label="Cancel" focused={focusedAction === "cancel"} />
          </div>
        </div>
      </div>
    )
  }

  if (!spec) return null

  const summary = describeSpecSummary(spec)
  const toolLabel = describeSpecTool(spec)
  const isBash = spec.variant === "bash"
  const isEditWrite = spec.variant === "edit" || spec.variant === "write" || spec.variant === "notebookEdit"

  return (
    <div className={cn("@container mx-3 mb-2", className)}>
      <div className="rounded-lg border border-border bg-muted/60 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex min-w-0 items-center gap-1.5">
            <ToolIconForSpec spec={spec} />
            <span className="font-medium text-foreground">{toolLabel}</span>
            {description && (
              <span className="min-w-0 truncate text-muted-foreground">{description}</span>
            )}
          </div>
          <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5" />
          </button>
        </div>

        {isBash && dangerouslyDisableSandbox && (
          <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <span className="text-xs font-medium text-amber-500">
              Sandbox override requested
            </span>
          </div>
        )}

        {summary && (
          <p
            className={cn(
              "mb-2 text-xs text-muted-foreground",
              isBash
                ? "max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono"
                : "truncate",
            )}
          >
            {summary}
          </p>
        )}

        {isEditWrite && (
          <div className="mb-2 max-h-64 overflow-y-auto rounded bg-muted/50 text-xs">
            <EditWriteDiff spec={spec} />
          </div>
        )}

        {blockedPath && (
          <p className="mb-2 break-all text-xs text-amber-600 dark:text-amber-400">
            Blocked path: {blockedPath}
          </p>
        )}

        {decisionReason && (
          <p className="mb-2 text-xs text-muted-foreground">{decisionReason}</p>
        )}

        <div className="flex flex-col gap-2">
          {mode === "codex_decision" ? (
            <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              <ActionPill color="green" label="Allow" kbd="⏎" focused={focusedAction === "allow"} />
              <ActionPill
                color="blue"
                label="Allow for session"
                kbd="⇧↵"
                focused={focusedAction === "always_allow"}
              />
              <ActionPill color="red" label="Decline" kbd="esc" focused={focusedAction === "decline"} />
              <ActionPill color="ghost" label="Cancel" focused={focusedAction === "cancel"} />
            </div>
          ) : (
            <DefaultActions
              focusedAction={focusedAction}
              feedbackPlaceholder={feedbackPlaceholder}
              suggestionCount={suggestions?.filter((s) => s.selected).length ?? 0}
            />
          )}

          {suggestions && suggestions.length > 0 && mode === "default" && (
            <div className="grid grid-cols-1 gap-1.5">
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex h-7 w-full items-center gap-1.5 rounded border px-2.5 text-[11px]",
                    s.selected
                      ? "border-green-500/50 bg-green-500/10 text-green-500"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {s.selected
                    ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
                    : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
                  }
                  <span className="min-w-0 truncate">{s.label}</span>
                  <Kbd variant="square" className="ml-auto">
                    {i + 1}
                  </Kbd>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DefaultActions({
  focusedAction,
  feedbackPlaceholder,
  suggestionCount = 0,
}: {
  focusedAction: PermissionAction
  feedbackPlaceholder: string
  suggestionCount?: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        className={cn(
          "h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600",
          focusedAction === "allow" && "ring-2 ring-green-600/60 ring-offset-1 ring-offset-muted/60",
        )}
      >
        Allow
        {suggestionCount > 0 && (
          <span className="ml-1 text-[10px] text-green-200/80">+{suggestionCount}</span>
        )}
        <Kbd variant="inline" className="ml-1 text-green-200/80">
          ⏎
        </Kbd>
      </Button>
      <Button
        size="sm"
        className={cn(
          "h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600",
          focusedAction === "deny" && "ring-2 ring-red-600/60 ring-offset-1 ring-offset-muted/60",
        )}
      >
        Deny
        <Kbd variant="inline" className="ml-1 text-red-200/80">
          esc
        </Kbd>
      </Button>
      <div className="relative flex min-w-0 basis-full items-center @lg:basis-0 @lg:flex-1">
        <div className="flex h-7 w-full items-center rounded bg-muted px-2 pr-12 text-xs text-muted-foreground">
          {feedbackPlaceholder}
        </div>
        <Kbd className="pointer-events-none absolute right-2">⇥</Kbd>
      </div>
    </div>
  )
}

function EditWriteDiff({ spec }: { spec: ToolBlockSpec }) {
  if (spec.variant === "edit") {
    return (
      <EditDiffBody
        oldText={spec.oldText}
        newText={spec.newText}
        startLine={spec.startLine ?? 1}
        filePath={spec.filePath}
      />
    )
  }
  if (spec.variant === "write") {
    return (
      <EditDiffBody
        oldText=""
        newText={spec.content}
        startLine={spec.startLine ?? 1}
        filePath={spec.filePath}
      />
    )
  }
  if (spec.variant === "notebookEdit") {
    return (
      <EditDiffBody
        oldText={spec.oldSource}
        newText={spec.newSource}
        startLine={1}
        filePath={spec.notebookPath}
      />
    )
  }
  return null
}

function ActionPill({
  color,
  label,
  kbd,
  focused,
}: {
  color: "green" | "red" | "blue" | "ghost"
  label: string
  kbd?: string
  focused: boolean
}) {
  const colorCls =
    color === "green"
      ? "bg-green-700 text-white hover:bg-green-600"
      : color === "red"
        ? "bg-red-700 text-white hover:bg-red-600"
        : color === "blue"
          ? "bg-blue-600 text-white hover:bg-blue-500"
          : "border border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
  const kbdCls =
    color === "green"
      ? "text-green-200/80"
      : color === "red"
        ? "text-red-200/80"
        : color === "blue"
          ? "text-blue-200/80"
          : "text-muted-foreground"
  return (
    <Button
      size="sm"
      className={cn(
        "h-7 cursor-pointer px-3 text-xs",
        colorCls,
        focused && "ring-2 ring-offset-1 ring-offset-muted/60",
        focused && color === "green" && "ring-green-600/60",
        focused && color === "red" && "ring-red-600/60",
        focused && color === "blue" && "ring-blue-600/60",
        focused && color === "ghost" && "ring-ring/60",
      )}
    >
      {label}
      {kbd && (
        <Kbd variant="inline" className={cn("ml-1", kbdCls)}>
          {kbd}
        </Kbd>
      )}
    </Button>
  )
}

function ToolIconForSpec({ spec }: { spec: ToolBlockSpec }): ReactNode {
  const cls = "size-3.5 shrink-0 text-muted-foreground"
  switch (spec.variant) {
    case "bash":
      return <Terminal className={cls} />
    case "edit":
    case "fileChange":
      return <FileEdit className={cls} />
    case "read":
      return <FileText className={cls} />
    case "write":
    case "notebookEdit":
      return <FilePlus2 className={cls} />
    case "grep":
      return <Search className={cls} />
    case "glob":
      return <FolderSearch className={cls} />
    case "webSearch":
    case "webFetch":
      return <Globe className={cls} />
    case "task":
      return <Bot className={cls} />
    case "mcp":
      return spec.iconSrc ? (
        <img src={spec.iconSrc} alt={spec.serverName} className="size-3.5 shrink-0 rounded-sm object-cover" />
      ) : (
        <Plug className={cls} />
      )
    case "skill":
    case "generic":
    case "banner":
      return <Wrench className={cls} />
    case "askUserQuestion":
      return <ClipboardList className={cls} />
  }
}

function describeSpecTool(spec: ToolBlockSpec): ReactNode {
  switch (spec.variant) {
    case "bash":
      return "Bash"
    case "edit":
      return "Edit"
    case "read":
      return "Read"
    case "write":
      return "Write"
    case "grep":
      return "Grep"
    case "glob":
      return "Glob"
    case "webSearch":
      return "WebSearch"
    case "webFetch":
      return "WebFetch"
    case "task":
      return "Task"
    case "mcp":
      return (
        <>
          {spec.serverName}
          <span className="text-muted-foreground"> · </span>
          {spec.toolName}
        </>
      )
    case "skill":
      return "Skill"
    case "notebookEdit":
      return "NotebookEdit"
    case "fileChange":
      return "FileChange"
    case "askUserQuestion":
      return "AskUserQuestion"
    case "banner":
      return "Banner"
    case "generic":
      return spec.tool
  }
}

function describeSpecSummary(spec: ToolBlockSpec): string {
  switch (spec.variant) {
    case "bash":
      return spec.command
    case "edit":
    case "write":
      return spec.filePath
    case "read":
      return spec.lineRange ? `${spec.filePath}:${spec.lineRange}` : spec.filePath
    case "grep":
      return `${spec.pattern}${spec.path ? ` in ${spec.path}` : ""}`
    case "glob":
      return `${spec.pattern}${spec.path ? ` in ${spec.path}` : ""}`
    case "webSearch":
      return spec.query
    case "webFetch":
      return spec.url
    case "task":
      return spec.description ?? spec.subagent
    case "mcp":
      return spec.summary ?? ""
    case "skill":
      return spec.skill
    case "notebookEdit":
      return spec.notebookPath
    case "fileChange":
      return `${spec.filePath} · ${spec.kind}`
    case "askUserQuestion":
      return spec.summary ?? ""
    case "banner":
      return ""
    case "generic":
      return spec.summary ?? ""
  }
}
