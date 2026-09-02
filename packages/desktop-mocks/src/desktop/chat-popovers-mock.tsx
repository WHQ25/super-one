"use client"

import { type ReactNode } from "react"
import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
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
import { ModelEffortTriggerMock } from "./chat-input-mock"
import type { Harness } from "./icons"
import { useMockT } from "./i18n"
import { harnessShowcaseMeta } from "./showcase-catalog"

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

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

export interface ModelSelectorPopoverMockProps {
  models?: ModelEntry[]
  activeId?: string
  title?: string
  className?: string
}

const DEFAULT_CLAUDE_MODELS: ModelEntry[] = [
  {
    id: "claude-opus-4-8",
    name: "Opus 4.8",
    description: "Opus 4.8 with 1M context · Most capable for complex work",
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

const DEFAULT_EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"]

export interface GroupedModelEffortPopoverMockProps {
  models?: ModelEntry[]
  activeId?: string
  levels?: EffortLevel[]
  activeLevel?: EffortLevel
  modelsExpanded?: boolean
  title?: string
  className?: string
}

/**
 * Current model selector surface. The selected model and effort slider share
 * one popover; opening the model row swaps the slider for the model list.
 */
export function GroupedModelEffortPopoverMock({
  models = DEFAULT_CLAUDE_MODELS,
  activeId = "claude-opus-4-8",
  levels = DEFAULT_EFFORT_LEVELS,
  activeLevel = "xhigh",
  modelsExpanded = false,
  title = "Models",
  className,
}: GroupedModelEffortPopoverMockProps) {
  const t = useMockT()
  const activeModel = models.find((model) => model.id === activeId) ?? models[0]
  const selectedIndex = Math.max(0, levels.indexOf(activeLevel))
  const lastIndex = Math.max(0, levels.length - 1)
  const stopAt = (index: number) =>
    lastIndex === 0
      ? "14px"
      : `calc(${index / lastIndex} * (100% - 28px) + 14px)`
  const selectedPosition = stopAt(selectedIndex)

  return (
    <PopoverShell width={288} className={className}>
      <PopoverTitle>{title}</PopoverTitle>

      {modelsExpanded ? (
        <div className="max-h-60 overflow-y-auto pr-1">
          {models.map((model) => {
            const active = model.id === activeId
            return (
              <PopoverItem key={model.id} active={active}>
                <div className="truncate font-medium">{model.name}</div>
                {model.description && (
                  <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                    {model.description}
                  </div>
                )}
              </PopoverItem>
            )
          })}
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-tight">
              {activeModel?.name ?? "Model"}
            </div>
            {activeModel?.description && (
              <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                {activeModel.description}
              </div>
            )}
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {!modelsExpanded && levels.length > 1 && (
        <div className="mt-1 border-t border-border px-2 pb-2 pt-2">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Effort</span>
            <span className="font-medium text-primary">
              {t(`settings.preferences.effort.levels.${activeLevel}`)}
            </span>
          </div>
          <div
            role="slider"
            aria-label="Effort"
            aria-valuemin={0}
            aria-valuemax={lastIndex}
            aria-valuenow={selectedIndex}
            className="relative h-6 rounded-full bg-muted"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: selectedPosition }}
            />
            {levels.map((level, index) => {
              return (
                <span
                  key={level}
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                    index < selectedIndex
                      ? "bg-primary-foreground/50"
                      : "bg-muted-foreground/40",
                  )}
                  style={{ left: stopAt(index) }}
                />
              )
            })}
            <span
              aria-hidden
              className="absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card shadow-md"
              style={{ left: selectedPosition }}
            />
          </div>
        </div>
      )}
    </PopoverShell>
  )
}

export function ModelSelectorPopoverMock({
  models = DEFAULT_CLAUDE_MODELS,
  activeId = "claude-opus-4-8",
  title,
  className,
}: ModelSelectorPopoverMockProps) {
  return (
    <GroupedModelEffortPopoverMock
      models={models}
      activeId={activeId}
      modelsExpanded
      title={title}
      className={className}
    />
  )
}

export interface EffortSelectorPopoverMockProps {
  levels?: EffortLevel[]
  activeLevel?: EffortLevel
  title?: string
  className?: string
}

export function EffortSelectorPopoverMock({
  levels = DEFAULT_EFFORT_LEVELS,
  activeLevel = "xhigh",
  title,
  className,
}: EffortSelectorPopoverMockProps) {
  return (
    <GroupedModelEffortPopoverMock
      levels={levels}
      activeLevel={activeLevel}
      title={title}
      className={className}
    />
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
    color: "text-primary",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Model classifier decides each permission",
    icon: <Zap className="size-3" />,
    color: "text-warning",
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-accept file edit operations",
    icon: <FastForward className="size-3" />,
    color: "text-success",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    description: "Deny anything not pre-approved",
    icon: <Lock className="size-3" />,
    color: "text-warning",
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
  title,
  className,
}: PermissionModePopoverMockProps) {
  const t = useMockT()
  return (
    <PopoverShell width={208} className={className}>
      <PopoverTitle>{title ?? t("chat.permissionModeTitle")}</PopoverTitle>
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
                {t(`chat.permissionModes.${mode.id}.label`)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {isAutoBlocked ? autoBlockedMessage : t(`chat.permissionModes.${mode.id}.description`)}
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
    color: "text-success",
  },
  {
    id: "auto",
    label: "Sandbox Auto",
    description: "Sandbox with auto-allow Bash",
    icon: <Box className="size-3" />,
    color: "text-warning",
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
  title,
  className,
}: SandboxModePopoverMockProps) {
  const t = useMockT()
  return (
    <PopoverShell width={224} className={className}>
      <PopoverTitle>{title ?? t("chat.sandboxModeTitle")}</PopoverTitle>
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
              {t(`chat.sandboxModes.${mode.id}.label`)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{t(`chat.sandboxModes.${mode.id}.description`)}</div>
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
  const t = useMockT()
  const options: Array<{
    id: CodexPermissionId
    label: string
    description: string
    icon: ReactNode
    toneClass: string
  }> = [
    {
      id: "default",
      label: t("resources.automation.defaultValue"),
      description: "Sandboxed read/run, asks before edits & network.",
      icon: <ShieldCheck className="size-3.5" />,
      toneClass: "text-foreground",
    },
    {
      id: "full-access",
      label: t("resources.automation.fullAccess"),
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
  branches = ["main", "feat/realtime-timeline", "feat/side-chat", "fix/harness-picker", "release/0.59.x"],
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
                      <span className="ml-1 text-success">+{fmtNumber(dirty.insertions)}</span>
                    )}
                    {dirty.deletions > 0 && (
                      <span className="ml-1 text-destructive">-{fmtNumber(dirty.deletions)}</span>
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
  branches = ["feat/realtime-timeline", "fix/harness-picker", "release/0.59.x"],
  baseHeading = "Create worktree from",
  search = "",
  className,
}: WorktreePopoverMockProps) {
  const t = useMockT()
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
          <span className="flex-1 truncate text-left">{t("tooltips.local")}</span>
          {!isInWorktree && <Check className="size-3 shrink-0 text-foreground" />}
        </div>

        {entries.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("chat.worktree.existingHeading")}
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
                      filesCount > 0 ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    {filesCount > 0 ? t("chat.worktree.filesCount", { count: filesCount }) : t("chat.worktree.cleanLabel")}
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
  harness?: Harness
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
  plan: "text-primary",
  auto: "text-warning",
  acceptEdits: "text-success",
  dontAsk: "text-warning",
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
  on: "text-success",
  auto: "text-warning",
}

const SANDBOX_ICON: Record<SandboxModeId, ReactNode> = {
  off: <PackageOpen className="size-3" />,
  on: <Box className="size-3" />,
  auto: <Box className="size-3" />,
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
  permission,
  sandbox,
  harness = "claude",
  activeTrigger = null,
  className,
}: ChatStatusBarMockProps) {
  const effectivePermission = permission ?? {
    id: "default",
    label: harnessShowcaseMeta(harness).permission,
  }
  const harnessMeta = harnessShowcaseMeta(harness)
  const effectiveSandbox = sandbox ?? harnessMeta.sandbox
  const sandboxIsInteractive = harnessMeta.sandboxInteractive
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
        trailing={branchDirty ? <Circle className="size-1.5 fill-warning text-warning" /> : null}
      />
      <div className="h-3 w-px bg-border" />
      <StatusBarTrigger
        icon={PERMISSION_ICON[effectivePermission.id]}
        label={effectivePermission.label}
        active={activeTrigger === "permission" || activeTrigger === "codex-permission"}
        colorClassName={PERMISSION_TONE[effectivePermission.id]}
      />
      <div className="flex-1" />
      <StatusBarTrigger
        icon={SANDBOX_ICON[effectiveSandbox]}
        label={SANDBOX_TRIGGER_LABEL[effectiveSandbox]}
        active={activeTrigger === "sandbox"}
        colorClassName={SANDBOX_TONE[effectiveSandbox]}
        showChevron={sandboxIsInteractive}
      />
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
  modelLabel = "Opus 4.8",
  effortLabel,
  activeTrigger = null,
  className,
}: ModelEffortTriggerStripProps) {
  const t = useMockT()
  return (
    <ModelEffortTriggerMock
      modelLabel={modelLabel}
      effortLabel={effortLabel ?? t("settings.preferences.effort.levels.xhigh")}
      active={activeTrigger !== null}
      className={className}
    />
  )
}
