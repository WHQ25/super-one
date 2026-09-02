"use client"

import {
  ArrowUp,
  AudioLines,
  Box,
  ChevronDown,
  Circle,
  Clock3,
  FolderClosed,
  GitBranch,
  Loader2,
  MonitorUp,
  PackageOpen,
  Paperclip,
  Shield,
  Square,
  Users,
  X,
} from "lucide-react"
import { IconButton } from "@superone/ui/components/ui/icon-button"
import { cn } from "@superone/ui/lib/utils"
import type { Harness } from "./icons"
import { useMockT } from "./i18n"
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
  workDirName?: string
  branch?: string
  branchDirty?: boolean
  permissionLabel?: string
  sandboxLabel?: "Off" | "On" | "Auto"
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
  workDirName = "super-one",
  branch = "main",
  branchDirty = true,
  permissionLabel,
  sandboxLabel,
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
  const resolvedPermissionLabel = permissionLabel ?? harnessMeta.permission
  const resolvedSandboxLabel = sandboxLabel ?? SHOWCASE_SANDBOX_LABEL[harnessMeta.sandbox]
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
        workDirName={workDirName}
        branch={branch}
        branchDirty={branchDirty}
        permissionLabel={resolvedPermissionLabel}
        sandboxLabel={resolvedSandboxLabel}
        backgroundAgents={backgroundAgents}
        pipKind={pipKind}
      />
    </div>
  )
}

export interface ChatStatusBarMockProps {
  harness: Harness
  workDirName: string
  branch: string
  branchDirty: boolean
  permissionLabel: string
  sandboxLabel: "Off" | "On" | "Auto"
  backgroundAgents: number
  pipKind?: MockPipKind
}

const SANDBOX_COLOR: Record<"Off" | "On" | "Auto", string> = {
  Off: "text-muted-foreground",
  On: "text-success",
  Auto: "text-warning",
}

export function ChatStatusBarMock({
  harness,
  workDirName,
  branch,
  branchDirty,
  permissionLabel,
  sandboxLabel,
  backgroundAgents,
  pipKind,
}: ChatStatusBarMockProps) {
  const sandboxInteractive = harnessShowcaseMeta(harness).sandboxInteractive
  const SandboxIcon = sandboxLabel === "Off" ? PackageOpen : Box

  return (
    <div className="flex items-center gap-2 whitespace-nowrap px-3 pb-1 pt-0.5 @lg:px-7 @lg:pb-3 @lg:pt-1 text-[11px] text-muted-foreground">
      <button
        type="button"
        className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
        title={workDirName}
      >
        <FolderClosed className="size-3" />
        <span className="max-w-[140px] truncate">{workDirName}</span>
      </button>

      <div className="h-3 w-px bg-border" />

      <button
        type="button"
        className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <GitBranch className="size-3" />
        <span className="max-w-[140px] truncate">{branch}</span>
        {branchDirty && <Circle className="size-1.5 fill-warning text-warning" />}
        <ChevronDown className="size-3" />
      </button>

      <div className="h-3 w-px bg-border" />

      <button
        type="button"
        className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Shield className="size-3" />
        <span>{permissionLabel}</span>
        <ChevronDown className="size-3" />
      </button>

      <div className="flex-1" />

      {backgroundAgents > 0 && (
        <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted">
          <Users className="size-3" />
          <span>{backgroundAgents}</span>
        </button>
      )}

      {pipKind && (
        <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted">
          <MonitorUp className="size-3" />
          <span className="capitalize">{pipKind}</span>
        </button>
      )}

      {sandboxInteractive ? (
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-muted",
            SANDBOX_COLOR[sandboxLabel],
          )}
          title={`Sandbox ${sandboxLabel}`}
        >
          <SandboxIcon className="size-3" />
          <span>{sandboxLabel}</span>
          <ChevronDown className="size-3" />
        </button>
      ) : (
        <span
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]",
            SANDBOX_COLOR[sandboxLabel],
          )}
          title={`Sandbox ${sandboxLabel}`}
          aria-label={`Sandbox ${sandboxLabel}`}
        >
          <SandboxIcon className="size-3" />
          <span>{sandboxLabel}</span>
        </span>
      )}
    </div>
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
