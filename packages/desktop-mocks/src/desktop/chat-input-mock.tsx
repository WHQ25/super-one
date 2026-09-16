"use client"

import type { ReactNode } from "react"
import {
  ArrowUp,
  AudioLines,
  Box,
  ChevronDown,
  Circle,
  Clock3,
  GitBranch,
  GitBranchPlus,
  Loader2,
  Monitor,
  MonitorUp,
  PackageOpen,
  Paperclip,
  Square,
  Users,
  X,
} from "lucide-react"
import { IconButton } from "@superone/ui/components/ui/icon-button"
import { cn } from "@superone/ui/lib/utils"
import type { Harness } from "./icons"
import { useMockT } from "./i18n"
import {
  codexPermissionPreset,
  permissionMode,
  permissionModeByLabel,
  type CodexPermissionId,
  type PermissionModeId,
} from "./permission-modes"
import {
  harnessShowcaseMeta,
  SHOWCASE_SANDBOX_LABEL,
} from "./showcase-catalog"

export type MockVoiceState = "hidden" | "idle" | "starting" | "active" | "stopping"
export type MockPipKind = "browser" | "computer" | "device"

export interface ChatInputMockProps {
  placeholder?: string
  modelLabel?: string
  effortLabel?: string
  contextPct?: number
  harness?: Harness
  worktree?: string | null
  branch?: string
  branchDirty?: boolean
  permission?: ChatStatusBarMockProps["permission"]
  sandbox?: SandboxModeId
  voiceState?: MockVoiceState
  streaming?: boolean
  scheduled?: boolean
  scheduledLabel?: string
  backgroundAgents?: number
  pipKind?: MockPipKind
  className?: string
}

export function ChatInputMock({
  placeholder,
  modelLabel,
  effortLabel,
  contextPct = 0.18,
  harness = "claude",
  worktree = null,
  branch = "main",
  branchDirty = true,
  permission,
  sandbox,
  voiceState,
  streaming = false,
  scheduled = false,
  scheduledLabel,
  backgroundAgents = 0,
  pipKind,
  className,
}: ChatInputMockProps) {
  const t = useMockT()
  const harnessMeta = harnessShowcaseMeta(harness)
  const model = modelLabel ?? harnessMeta.model
  const effort = effortLabel ?? t("settings.preferences.effort.levels.xhigh")
  const placeholderText = placeholder ?? harnessMeta.placeholder
  const resolvedVoiceState = voiceState ?? (harness === "codex" ? "idle" : "hidden")

  return (
    <div className={cn("@container mx-auto w-full min-w-0 max-w-3xl", className)}>
      <div className="relative mx-3 mb-1 rounded-xl border border-border px-4 py-3">
        <div className="min-h-[36px] text-[15px] leading-6 text-muted-foreground/70 select-none">{placeholderText}</div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Attach"
            >
              <Paperclip className="size-3.5" />
            </button>

            <ModelEffortTriggerMock modelLabel={model} effortLabel={effort} />
          </div>

          <div className="flex items-center gap-1.5">
            <ContextDial pct={contextPct} />
            {streaming && (
              <IconButton size="md" tooltip="Stop" className="rounded-full border border-border">
                <Square />
              </IconButton>
            )}
            <ScheduledSendControlMock
              scheduled={scheduled}
              scheduledLabel={scheduledLabel}
            />
            {resolvedVoiceState !== "hidden" && !streaming && (
              <ComposerVoiceButtonMock state={resolvedVoiceState} />
            )}
          </div>
        </div>
      </div>

      <ChatStatusBarMock
        harness={harness}
        worktree={worktree}
        branch={branch}
        branchDirty={branchDirty}
        permission={permission}
        sandbox={sandbox}
        backgroundAgents={backgroundAgents}
        pipKind={pipKind}
      />
    </div>
  )
}

export type SandboxModeId = "off" | "on" | "auto"

export interface ChatStatusBarMockProps {
  harness?: Harness
  /**
   * Checkout the session runs in. `null` is the main checkout, which the
   * desktop labels "Local"; a string is the worktree's branch name.
   */
  worktree?: string | null
  branch?: string
  branchDirty?: boolean
  /** Claude-style permission mode. Defaults to the harness showcase mode. */
  permission?: { id: PermissionModeId; label?: string }
  /** Codex approval preset; wins over `permission` for the Codex harness. */
  codexPermission?: CodexPermissionId
  /** Defaults to the harness showcase sandbox state. */
  sandbox?: SandboxModeId
  backgroundAgents?: number
  pipKind?: MockPipKind
  activeTrigger?: "workdir" | "branch" | "permission" | "codex-permission" | "sandbox" | null
  className?: string
}

const SANDBOX_TONE: Record<SandboxModeId, string> = {
  off: "text-muted-foreground",
  on: "text-success",
  auto: "text-warning",
}

export function ChatStatusBarMock({
  harness = "claude",
  worktree = null,
  branch = "main",
  branchDirty = true,
  permission,
  codexPermission,
  sandbox,
  backgroundAgents = 0,
  pipKind,
  activeTrigger = null,
  className,
}: ChatStatusBarMockProps) {
  const t = useMockT()
  const harnessMeta = harnessShowcaseMeta(harness)
  const codexPreset = harness === "codex" && !permission
    ? codexPermissionPreset(codexPermission ?? harnessMeta.codexPermission ?? "default")
    : null
  const mode = codexPreset
    ? { icon: codexPreset.triggerIcon, label: t(codexPreset.labelKey), color: codexPreset.triggerToneClass }
    : permission
      ? { ...permissionMode(permission.id), label: permission.label ?? permissionMode(permission.id).label }
      // Harnesses without Claude-style modes keep their own label on the Normal chrome.
      : { ...permissionModeByLabel(harnessMeta.permission), label: harnessMeta.permission }
  const sandboxMode = sandbox ?? harnessMeta.sandbox
  const sandboxInteractive = harnessMeta.sandboxInteractive
  const SandboxIcon = sandboxMode === "off" ? PackageOpen : Box

  return (
    <div
      className={cn(
        "flex items-center gap-2 whitespace-nowrap px-3 pb-1 pt-0.5 text-[11px] text-muted-foreground @lg:px-7 @lg:pb-3 @lg:pt-1",
        className,
      )}
    >
      <StatusBarTrigger
        icon={worktree ? <GitBranchPlus className="size-3" /> : <Monitor className="size-3" />}
        label={worktree ?? t("tooltips.local")}
        active={activeTrigger === "workdir"}
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
        icon={mode.icon}
        label={mode.label}
        active={activeTrigger === "permission" || activeTrigger === "codex-permission"}
        colorClassName={mode.color}
      />

      <div className="flex-1" />

      {backgroundAgents > 0 && (
        <StatusBarTrigger icon={<Users className="size-3" />} label={String(backgroundAgents)} showChevron={false} />
      )}

      {pipKind && (
        <StatusBarTrigger
          icon={<MonitorUp className="size-3" />}
          label={<span className="capitalize">{pipKind}</span>}
          showChevron={false}
        />
      )}

      <StatusBarTrigger
        icon={<SandboxIcon className="size-3" />}
        label={SHOWCASE_SANDBOX_LABEL[sandboxMode]}
        active={activeTrigger === "sandbox"}
        colorClassName={SANDBOX_TONE[sandboxMode]}
        showChevron={sandboxInteractive}
      />
    </div>
  )
}

export interface StatusBarTriggerProps {
  icon: ReactNode
  label: ReactNode
  active?: boolean
  colorClassName?: string
  showChevron?: boolean
  trailing?: ReactNode
}

/** One chip in the composer status bar: icon, label, optional dirty dot, optional chevron. */
export function StatusBarTrigger({
  icon,
  label,
  active = false,
  colorClassName = "text-muted-foreground",
  showChevron = true,
  trailing,
}: StatusBarTriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-muted hover:text-foreground",
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
    </button>
  )
}

export interface ModelEffortTriggerMockProps {
  modelLabel: string
  effortLabel?: string | null
  active?: boolean
  className?: string
}

/** Current desktop model and effort selector: one trigger, one popover. */
export function ModelEffortTriggerMock({
  modelLabel,
  effortLabel,
  active = false,
  className,
}: ModelEffortTriggerMockProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex min-w-0 max-w-xl items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        <span className="min-w-0 shrink truncate">{modelLabel}</span>
        {effortLabel && (
          <>
            <span className="shrink-0 text-muted-foreground/70">·</span>
            <span className="min-w-0 shrink-[64] truncate">{effortLabel}</span>
          </>
        )}
      </span>
      <ChevronDown className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
    </button>
  )
}

export interface ScheduledSendControlMockProps {
  scheduled?: boolean
  scheduledLabel?: string
  canSend?: boolean
}

/** Static counterpart of the production scheduled-send control's armed state. */
export function ScheduledSendControlMock({
  scheduled = false,
  scheduledLabel = "Send at 6:30 PM",
  canSend = true,
}: ScheduledSendControlMockProps) {
  if (scheduled) {
    return (
      <div
        role="status"
        aria-label={scheduledLabel}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-warning/60 bg-warning/15 pl-2 pr-2.5 text-xs font-medium text-warning"
      >
        <Clock3 className="size-3.5 shrink-0" />
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{scheduledLabel}</span>
      </div>
    )
  }

  return (
    <IconButton
      size="md"
      variant="ghost"
      tooltip="Send"
      disabled={!canSend}
      className="rounded-full border border-border disabled:opacity-30"
    >
      <ArrowUp />
    </IconButton>
  )
}

export function ComposerVoiceButtonMock({ state }: { state: Exclude<MockVoiceState, "hidden"> }) {
  const busy = state === "starting" || state === "stopping"
  const active = state === "active" || state === "stopping"
  return (
    <IconButton
      size="md"
      variant="ghost"
      disabled={busy}
      tooltip={active ? "Stop realtime voice" : "Start realtime voice"}
      className={cn(
        "rounded-full border",
        active
          ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
          : "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background",
      )}
    >
      {busy ? <Loader2 className="animate-spin" /> : active ? <X /> : <AudioLines />}
    </IconButton>
  )
}

export function ContextDial({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct))
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const used = circumference * clamped
  const strokeClass = clamped > 0.7 ? "stroke-destructive" : clamped > 0.4 ? "stroke-warning" : "stroke-success"
  return (
    <button
      type="button"
      aria-label={`Context ${(clamped * 100).toFixed(0)}%`}
      className="flex items-center rounded-sm p-1 transition-colors hover:bg-muted"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <circle cx="7" cy="7" r={radius} fill="none" className="stroke-border" strokeWidth="2" />
        {clamped > 0 && (
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            className={strokeClass}
            strokeWidth="2"
            strokeDasharray={`${used} ${circumference - used}`}
            strokeDashoffset={circumference * 0.25}
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  )
}
