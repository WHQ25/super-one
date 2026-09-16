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
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"
import { EditDiffBody, type ToolBlockSpec } from "./tool-block-mock"
import { useMockT } from "./i18n"
import { ApproveRejectBarMock, PermissionActionButtonMock } from "./permission-action-bar-mock"
import { permissionMode, PermissionModeInline, type PermissionModeId } from "./permission-modes"

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
  /** Plain rule text, e.g. "Allow Bash(bun install) for this session". */
  label?: string
  /** Renders as "Switch to ⚡ Auto" in the mode's identity colour instead of `label`. */
  mode?: PermissionModeId
  selected?: boolean
}

export interface PermissionPromptMockProps {
  spec?: ToolBlockSpec
  mode?: PermissionMode
  description?: string
  decisionReason?: string
  /** Defaults to the desktop's "Deny reason (optional, Enter to submit)". */
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
  feedbackPlaceholder,
  focusedAction = "allow",
  sandboxNetwork,
  elicitation,
  suggestions,
  blockedPath,
  dangerouslyDisableSandbox = false,
  className,
}: PermissionPromptMockProps) {
  const t = useMockT()
  if (mode === "sandbox_network" && sandboxNetwork) {
    return (
      <div className={cn("@container mx-3 mb-2", className)}>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
              <span className="font-medium text-amber-500">{t("chat.permission.allowSandboxNetwork")}</span>
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
        ? "text-destructive"
        : elicitation.riskLevel === "medium"
          ? "text-amber-500"
          : "text-muted-foreground"
    return (
      <div className={cn("@container mx-3 mb-2", className)}>
        <div className="rounded-lg border border-border bg-card p-3">
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
                          f.value ? "justify-end bg-primary" : "justify-start bg-muted",
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
            <PermissionActionButtonMock tone="approve" focused={focusedAction === "allow"}>{t("chat.permission.allow")}</PermissionActionButtonMock>
            <PermissionActionButtonMock tone="primary" focused={focusedAction === "always_allow"}>{t("chat.permission.alwaysAllow")}</PermissionActionButtonMock>
            <PermissionActionButtonMock tone="reject" focused={focusedAction === "decline"}>{t("chat.permission.decline")}</PermissionActionButtonMock>
            <PermissionActionButtonMock tone="neutral" focused={focusedAction === "cancel"}>{t("common.cancel")}</PermissionActionButtonMock>
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
      <div className="rounded-lg border border-border bg-card p-3">
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
            <span className="text-xs font-medium text-amber-500">{t("chat.permission.sandboxOverride")}</span>
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
            {t("chat.permission.blockedPath", { path: blockedPath })}
          </p>
        )}

        {decisionReason && (
          <p className="mb-2 text-xs text-muted-foreground">{decisionReason}</p>
        )}

        <div className="flex flex-col gap-2">
          {mode === "codex_decision" ? (
            <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              <PermissionActionButtonMock tone="approve" kbd="⏎" focused={focusedAction === "allow"}>{t("chat.permission.allow")}</PermissionActionButtonMock>
              <PermissionActionButtonMock tone="primary" kbd="⇧↵" focused={focusedAction === "always_allow"}>{t("chat.permission.allowForSession")}</PermissionActionButtonMock>
              <PermissionActionButtonMock tone="reject" kbd="esc" focused={focusedAction === "decline"}>{t("chat.permission.decline")}</PermissionActionButtonMock>
              <PermissionActionButtonMock tone="neutral" focused={focusedAction === "cancel"}>{t("common.cancel")}</PermissionActionButtonMock>
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
              {suggestions.map((s, i) => {
                const modeMeta = s.mode ? permissionMode(s.mode) : null
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex h-7 w-full items-center gap-1.5 rounded border px-2.5 text-xs",
                      s.selected
                        ? modeMeta
                          ? cn("border-transparent", modeMeta.activeBg, modeMeta.color)
                          : "border-success/50 bg-success/10 text-success"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {s.selected
                      ? <CheckCircle2 className={cn("size-3.5 shrink-0", !modeMeta && "text-success")} />
                      : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
                    }
                    <span className="flex min-w-0 items-center gap-1 truncate">
                      {s.mode ? <>Switch to <PermissionModeInline id={s.mode} /></> : s.label}
                    </span>
                    <Kbd variant="square" className="ml-auto">
                      {i + 1}
                    </Kbd>
                  </div>
                )
              })}
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
  feedbackPlaceholder?: string
  suggestionCount?: number
}) {
  return (
    <ApproveRejectBarMock
      focused={focusedAction === "deny" ? "reject" : "approve"}
      approveSuffix={suggestionCount > 0 && (
        <span className="ml-1 text-xs text-success-foreground/70">+{suggestionCount}</span>
      )}
      feedback={{ placeholder: feedbackPlaceholder }}
    />
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
