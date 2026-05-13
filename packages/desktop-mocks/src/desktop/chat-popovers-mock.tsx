"use client"

import { type ReactNode } from "react"
import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  Circle,
  FastForward,
  GitBranch,
  GitCommit,
  Lock,
  Monitor,
  PackageOpen,
  PenLine,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Zap,
} from "lucide-react"
import { cn } from "@superone/ui/lib/utils"

export interface PopoverShellProps {
  width?: number
  align?: "start" | "end"
  className?: string
  children: ReactNode
}

export function PopoverShell({ width = 256, align = "start", className, children }: PopoverShellProps) {
  return (
    <div
      style={{ width }}
      className={cn(
        "rounded-md border border-border bg-card p-1 text-foreground shadow-md",
        align === "end" ? "origin-bottom-right" : "origin-bottom-left",
        className,
      )}
    >
      {children}
    </div>
  )
}

function PopoverTitle({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1.5 text-xs text-muted-foreground">{children}</div>
}

interface PopoverItemBaseProps {
  active?: boolean
  disabled?: boolean
  children: ReactNode
  trailing?: ReactNode
  className?: string
}

function PopoverItem({ active = false, disabled = false, children, trailing, className }: PopoverItemBaseProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
        active ? "bg-muted text-foreground" : "text-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
      {active && !trailing && <Check className="mt-0.5 size-3.5 shrink-0" />}
    </div>
  )
}

export interface ModelEntry {
  id: string
  name: string
  description?: string
}

export interface ModelSelectorPopoverMockProps {
  models?: ModelEntry[]
  activeId?: string
  title?: string
  className?: string
}

const DEFAULT_CLAUDE_MODELS: ModelEntry[] = [
  {
    id: "opus-4-7-1m",
    name: "Opus 4.7 1M",
    description: "Opus 4.7 with 1M context · Most capable for complex work",
  },
  {
    id: "sonnet-4-6",
    name: "Sonnet 4.6",
    description: "Sonnet 4.6 · Best for everyday tasks",
  },
  {
    id: "sonnet-4-6-1m",
    name: "Sonnet 4.6 1M",
    description: "Sonnet 4.6 with 1M context · Billed as extra usage · $3/$15 per Mtok",
  },
  {
    id: "haiku-4-5",
    name: "Haiku 4.5",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
]

export function ModelSelectorPopoverMock({
  models = DEFAULT_CLAUDE_MODELS,
  activeId = "opus-4-7-1m",
  title = "Select Model",
  className,
}: ModelSelectorPopoverMockProps) {
  return (
    <PopoverShell width={272} className={className}>
      <PopoverTitle>{title}</PopoverTitle>
      {models.map((model) => {
        const active = model.id === activeId
        return (
          <PopoverItem key={model.id} active={active}>
            <div className="truncate font-medium">{model.name}</div>
            {model.description && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">{model.description}</div>
            )}
          </PopoverItem>
        )
      })}
    </PopoverShell>
  )
}

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
}

export interface EffortSelectorPopoverMockProps {
  levels?: EffortLevel[]
  activeLevel?: EffortLevel
  title?: string
  className?: string
}

export function EffortSelectorPopoverMock({
  levels = ["low", "medium", "high", "xhigh", "max"],
  activeLevel = "xhigh",
  title = "Thinking Effort",
  className,
}: EffortSelectorPopoverMockProps) {
  return (
    <PopoverShell width={192} className={className}>
      <PopoverTitle>{title}</PopoverTitle>
      {levels.map((level) => {
        const active = level === activeLevel
        return (
          <PopoverItem key={level} active={active}>
            <div className="font-medium">{EFFORT_LABELS[level]}</div>
          </PopoverItem>
        )
      })}
    </PopoverShell>
  )
}

export type PermissionModeId =
  | "default"
  | "plan"
  | "auto"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions"

interface PermissionModeDescriptor {
  id: PermissionModeId
  label: string
  description: string
  icon: ReactNode
  color: string
}

const PERMISSION_MODES_DATA: PermissionModeDescriptor[] = [
  {
    id: "default",
    label: "Normal",
    description: "Prompts for dangerous operations",
    icon: <Shield className="size-3" />,
    color: "text-muted-foreground",
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Planning only, no actual execution",
    icon: <PenLine className="size-3" />,
    color: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Model classifier decides each permission",
    icon: <Zap className="size-3" />,
    color: "text-amber-600 dark:text-amber-400",
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-accept file edit operations",
    icon: <FastForward className="size-3" />,
    color: "text-purple-600 dark:text-purple-400",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    description: "Deny anything not pre-approved",
    icon: <Lock className="size-3" />,
    color: "text-orange-600 dark:text-orange-400",
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Bypass all permission checks",
    icon: <ShieldOff className="size-3" />,
    color: "text-destructive",
  },
]

export interface PermissionModePopoverMockProps {
  activeId?: PermissionModeId
  autoBlockedMessage?: string
  title?: string
  className?: string
}

export function PermissionModePopoverMock({
  activeId = "default",
  autoBlockedMessage,
  title = "Permission Mode",
  className,
}: PermissionModePopoverMockProps) {
  return (
    <PopoverShell width={208} className={className}>
      <PopoverTitle>{title}</PopoverTitle>
      {PERMISSION_MODES_DATA.map((mode) => {
        const isAutoBlocked = mode.id === "auto" && !!autoBlockedMessage
        const showDivider = mode.id === "dontAsk"
        const active = mode.id === activeId && !isAutoBlocked
        return (
          <div key={mode.id}>
            {showDivider && <div className="my-1 border-t border-border/60" />}
            <PopoverItem
              active={active}
              disabled={isAutoBlocked}
              trailing={active ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
            >
              <div className={cn("flex items-center gap-1.5 font-medium", mode.color)}>
                {mode.icon}
                {mode.label}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {isAutoBlocked ? autoBlockedMessage : mode.description}
              </div>
            </PopoverItem>
          </div>
        )
      })}
    </PopoverShell>
  )
}

export type SandboxModeId = "off" | "on" | "auto"

interface SandboxModeDescriptor {
  id: SandboxModeId
  label: string
  description: string
  icon: ReactNode
  color: string
}

const SANDBOX_MODES_DATA: SandboxModeDescriptor[] = [
  {
    id: "off",
    label: "Sandbox Off",
    description: "No execution isolation",
    icon: <PackageOpen className="size-3" />,
    color: "text-muted-foreground",
  },
  {
    id: "on",
    label: "Sandbox",
    description: "Commands run in sandboxed environment",
    icon: <Box className="size-3" />,
    color: "text-emerald-500 dark:text-emerald-400",
  },
  {
    id: "auto",
    label: "Sandbox Auto",
    description: "Sandbox with auto-allow Bash",
    icon: <Box className="size-3" />,
    color: "text-amber-600 dark:text-amber-400",
  },
]

export interface SandboxModePopoverMockProps {
  activeId?: SandboxModeId
  notReadyHint?: string
  title?: string
  className?: string
}

export function SandboxModePopoverMock({
  activeId = "on",
  notReadyHint,
  title = "Sandbox Mode",
  className,
}: SandboxModePopoverMockProps) {
  return (
    <PopoverShell width={224} className={className}>
      <PopoverTitle>{title}</PopoverTitle>
      {SANDBOX_MODES_DATA.map((mode) => {
        const active = mode.id === activeId
        return (
          <PopoverItem
            key={mode.id}
            active={active}
            trailing={active ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
          >
            <div className={cn("flex items-center gap-1.5 font-medium", mode.color)}>
              {mode.icon}
              {mode.label}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{mode.description}</div>
          </PopoverItem>
        )
      })}
      {notReadyHint && (
        <div className="mt-1 border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          {notReadyHint}
        </div>
      )}
    </PopoverShell>
  )
}

export type CodexPermissionId = "default" | "full-access"

export interface CodexPermissionPopoverMockProps {
  activeId?: CodexPermissionId
  title?: string
  className?: string
}

export function CodexPermissionPopoverMock({
  activeId = "default",
  title = "Codex permission preset",
  className,
}: CodexPermissionPopoverMockProps) {
  const options: Array<{
    id: CodexPermissionId
    label: string
    description: string
    icon: ReactNode
    toneClass: string
  }> = [
    {
      id: "default",
      label: "Default",
      description: "Sandboxed read/run, asks before edits & network.",
      icon: <ShieldCheck className="size-3.5" />,
      toneClass: "text-foreground",
    },
    {
      id: "full-access",
      label: "Full Access",
      description: "Bypass sandbox & approvals — use only when you trust the task.",
      icon: <AlertTriangle className="size-3.5" />,
      toneClass: "text-destructive",
    },
  ]

  return (
    <PopoverShell width={288} className={cn("p-2", className)}>
      <div className="space-y-1 text-xs">
        <PopoverTitle>{title}</PopoverTitle>
        {options.map((option) => {
          const active = option.id === activeId
          return (
            <div
              key={option.id}
              className={cn(
                "w-full rounded px-2 py-1.5 text-left transition-colors",
                active ? "bg-muted text-foreground" : "text-foreground",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={cn("inline-flex items-center gap-1.5 font-medium", option.toneClass)}>
                    {option.icon}
                    {option.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                </div>
                {active && <Check className="mt-0.5 size-3.5 shrink-0" />}
              </div>
            </div>
          )
        })}
      </div>
    </PopoverShell>
  )
}

export interface GitBranchDirty {
  files: number
  insertions: number
  deletions: number
}

export interface GitBranchPopoverMockProps {
  current: string
  dirty?: GitBranchDirty
  branches?: string[]
  search?: string
  showCreateBranch?: boolean
  className?: string
}

function fmtNumber(n: number) {
  return n.toLocaleString()
}

export function GitBranchPopoverMock({
  current,
  dirty,
  branches = ["main", "feat/popover-mocks", "fix/permission-lifecycle", "chore/upgrade-react", "release/0.31.x"],
  search = "",
  showCreateBranch = false,
  className,
}: GitBranchPopoverMockProps) {
  const lower = search.toLowerCase()
  const trimmed = search.trim()
  const currentMatch = current.toLowerCase().includes(lower)
  const otherBranches = branches.filter((b) => b !== current && b.toLowerCase().includes(lower))
  const canCreate =
    showCreateBranch &&
    trimmed.length > 0 &&
    trimmed.toLowerCase() !== current.toLowerCase() &&
    !branches.some((b) => b.toLowerCase() === trimmed.toLowerCase())

  return (
    <PopoverShell width={288} className={cn("p-0", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <input
          readOnly
          value={search}
          placeholder="Search or create branch…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-72 overflow-hidden p-1">
        {currentMatch && (
          <div className="rounded bg-muted px-2 py-1.5 text-xs">
            <div className="flex items-start gap-2">
              <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{current}</span>
                {dirty && dirty.files > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    uncommitted: {fmtNumber(dirty.files)} {dirty.files === 1 ? "file" : "files"}
                    {dirty.insertions > 0 && (
                      <span className="ml-1 text-green-500">+{fmtNumber(dirty.insertions)}</span>
                    )}
                    {dirty.deletions > 0 && (
                      <span className="ml-1 text-red-500">-{fmtNumber(dirty.deletions)}</span>
                    )}
                  </span>
                )}
              </div>
              <Check className="mt-0.5 size-3 shrink-0 text-foreground" />
            </div>
          </div>
        )}
        {otherBranches.length > 0 && (
          <>
            {currentMatch && <div className="my-1 border-t border-border/60" />}
            {otherBranches.map((b) => (
              <div key={b} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{b}</span>
              </div>
            ))}
          </>
        )}
        {canCreate && (
          <>
            <div className="my-1 border-t border-border/60" />
            <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
              <Plus className="size-3 shrink-0 text-muted-foreground" />
              <span>
                Create branch: <strong>{trimmed}</strong>
              </span>
            </div>
          </>
        )}
        {!currentMatch && otherBranches.length === 0 && !canCreate && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">No branches found</div>
        )}
      </div>
    </PopoverShell>
  )
}

export interface WorktreeEntryMock {
  branch: string | null
  shortHead: string
  dirtyFiles?: number
  isActive?: boolean
}

export interface WorktreePopoverMockProps {
  isInWorktree?: boolean
  entries?: WorktreeEntryMock[]
  branches?: string[]
  baseHeading?: string
  search?: string
  className?: string
}

export function WorktreePopoverMock({
  isInWorktree = false,
  entries = [
    { branch: "feat/relay-multimobile", shortHead: "a1b2c3d", dirtyFiles: 2 },
    { branch: "chore/upgrade-react", shortHead: "e4f5061" },
  ],
  branches = ["feat/popover-mocks", "fix/permission-lifecycle", "release/0.31.x"],
  baseHeading = "Create worktree from",
  search = "",
  className,
}: WorktreePopoverMockProps) {
  return (
    <PopoverShell width={320} className={cn("p-0", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <input
          readOnly
          value={search}
          placeholder="Search worktrees or branches…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-80 overflow-hidden">
        <div className="flex w-full items-center gap-2 px-3 py-1.5 text-xs">
          <Monitor className="size-3 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-left">Local</span>
          {!isInWorktree && <Check className="size-3 shrink-0 text-foreground" />}
        </div>

        {entries.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Existing worktrees
            </div>
            {entries.map((entry, i) => {
              const detached = !entry.branch
              const filesCount = entry.dirtyFiles ?? 0
              return (
                <div key={i} className="flex w-full items-start gap-2 px-3 py-1.5 text-xs">
                  {detached ? (
                    <GitCommit className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className={cn("truncate", detached && "text-muted-foreground")}>
                      {detached ? "(detached)" : entry.branch}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">{entry.shortHead}</span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      filesCount > 0 ? "text-amber-500" : "text-muted-foreground",
                    )}
                  >
                    {filesCount > 0 ? `${filesCount} files` : "clean"}
                  </span>
                  {entry.isActive && <Check className="mt-0.5 size-3 shrink-0 text-foreground" />}
                </div>
              )
            })}
          </>
        )}

        {branches.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {baseHeading}
            </div>
            {branches.map((b) => (
              <div key={b} className="flex w-full items-start gap-2 px-3 py-1.5 text-xs">
                <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="truncate">{b}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </PopoverShell>
  )
}

export interface StatusBarTriggerProps {
  icon: ReactNode
  label: string
  active?: boolean
  colorClassName?: string
  showChevron?: boolean
  trailing?: ReactNode
}

export function StatusBarTrigger({
  icon,
  label,
  active = false,
  colorClassName = "text-muted-foreground",
  showChevron = true,
  trailing,
}: StatusBarTriggerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors",
        colorClassName,
        active && "bg-muted text-foreground",
      )}
    >
      {icon}
      <span className="max-w-[140px] truncate">{label}</span>
      {trailing}
      {showChevron && (
        <ChevronDown className={cn("size-3 transition-transform duration-200", active && "rotate-180")} />
      )}
    </div>
  )
}

export interface ChatStatusBarMockProps {
  workDirName?: string
  branch?: string
  branchDirty?: boolean
  permission?: { id: PermissionModeId; label: string }
  sandbox?: SandboxModeId
  harness?: "claude" | "codex"
  activeTrigger?:
    | "workdir"
    | "branch"
    | "permission"
    | "sandbox"
    | "codex-permission"
    | null
  className?: string
}

const PERMISSION_TONE: Record<PermissionModeId, string> = {
  default: "text-muted-foreground",
  plan: "text-blue-600 dark:text-blue-400",
  auto: "text-amber-600 dark:text-amber-400",
  acceptEdits: "text-purple-600 dark:text-purple-400",
  dontAsk: "text-orange-600 dark:text-orange-400",
  bypassPermissions: "text-destructive",
}

const PERMISSION_ICON: Record<PermissionModeId, ReactNode> = {
  default: <Shield className="size-3" />,
  plan: <PenLine className="size-3" />,
  auto: <Zap className="size-3" />,
  acceptEdits: <FastForward className="size-3" />,
  dontAsk: <Lock className="size-3" />,
  bypassPermissions: <ShieldOff className="size-3" />,
}

const SANDBOX_TONE: Record<SandboxModeId, string> = {
  off: "text-muted-foreground",
  on: "text-emerald-500 dark:text-emerald-400",
  auto: "text-amber-600 dark:text-amber-400",
}

const SANDBOX_TRIGGER_LABEL: Record<SandboxModeId, string> = {
  off: "Off",
  on: "On",
  auto: "Auto",
}

export function ChatStatusBarMock({
  workDirName = "super-one",
  branch = "main",
  branchDirty = true,
  permission = { id: "default", label: "Normal" },
  sandbox = "on",
  harness = "claude",
  activeTrigger = null,
  className,
}: ChatStatusBarMockProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 whitespace-nowrap px-4 py-2 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <StatusBarTrigger
        icon={<Monitor className="size-3" />}
        label={workDirName}
        active={activeTrigger === "workdir"}
        showChevron={false}
      />
      <div className="h-3 w-px bg-border" />
      <StatusBarTrigger
        icon={<GitBranch className="size-3" />}
        label={branch}
        active={activeTrigger === "branch"}
        trailing={branchDirty ? <Circle className="size-1.5 fill-amber-500 text-amber-500" /> : null}
      />
      <div className="h-3 w-px bg-border" />
      <StatusBarTrigger
        icon={PERMISSION_ICON[permission.id]}
        label={permission.label}
        active={activeTrigger === "permission"}
        colorClassName={PERMISSION_TONE[permission.id]}
      />
      <div className="flex-1" />
      {harness === "claude" && (
        <StatusBarTrigger
          icon={<Box className="size-3" />}
          label={SANDBOX_TRIGGER_LABEL[sandbox]}
          active={activeTrigger === "sandbox"}
          colorClassName={SANDBOX_TONE[sandbox]}
        />
      )}
      {harness === "codex" && (
        <StatusBarTrigger
          icon={<ShieldCheck className="size-3" />}
          label="Default"
          active={activeTrigger === "codex-permission"}
        />
      )}
    </div>
  )
}

export interface ModelEffortTriggerStripProps {
  modelLabel?: string
  effortLabel?: string
  activeTrigger?: "model" | "effort" | null
  className?: string
}

export function ModelEffortTriggerStrip({
  modelLabel = "Opus 4.7 1M",
  effortLabel = "Extra High",
  activeTrigger = null,
  className,
}: ModelEffortTriggerStripProps) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <StatusBarTrigger icon={null} label={modelLabel} active={activeTrigger === "model"} />
      <StatusBarTrigger icon={null} label={effortLabel} active={activeTrigger === "effort"} />
    </div>
  )
}
