"use client"

import { ArrowUp, Box, ChevronDown, Circle, FolderClosed, GitBranch, Paperclip, Shield } from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import type { Harness } from "./icons"

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
  className?: string
}

const DEFAULT_MODEL: Record<Harness, string> = {
  claude: "Opus 4.7 1M",
  codex: "GPT-5.5",
}

const DEFAULT_EFFORT: Record<Harness, string> = {
  claude: "Extra High",
  codex: "Extra High",
}

const DEFAULT_PLACEHOLDER: Record<Harness, string> = {
  claude: "Ask Claude anything, @ to mention files & agents, / for commands",
  codex: "Ask Codex anything, @ to mention, / for commands",
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
  permissionLabel = "Normal",
  sandboxLabel = "On",
  className,
}: ChatInputMockProps) {
  const model = modelLabel ?? DEFAULT_MODEL[harness]
  const effort = effortLabel ?? DEFAULT_EFFORT[harness]
  const placeholderText = placeholder ?? DEFAULT_PLACEHOLDER[harness]

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

            <button
              type="button"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-[140px] truncate">{model}</span>
              <ChevronDown className="size-3" />
            </button>

            <button
              type="button"
              className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-[100px] truncate">{effort}</span>
              <ChevronDown className="size-3" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <ContextDial pct={contextPct} />
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <ChatStatusBarMock
        harness={harness}
        workDirName={workDirName}
        branch={branch}
        branchDirty={branchDirty}
        permissionLabel={permissionLabel}
        sandboxLabel={sandboxLabel}
      />
    </div>
  )
}

interface ChatStatusBarMockProps {
  harness: Harness
  workDirName: string
  branch: string
  branchDirty: boolean
  permissionLabel: string
  sandboxLabel: "Off" | "On" | "Auto"
}

const SANDBOX_COLOR: Record<"Off" | "On" | "Auto", string> = {
  Off: "text-muted-foreground hover:bg-muted",
  On: "text-emerald-500 hover:bg-emerald-500/10 dark:text-emerald-400",
  Auto: "text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
}

function ChatStatusBarMock({ harness, workDirName, branch, branchDirty, permissionLabel, sandboxLabel }: ChatStatusBarMockProps) {
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
        {branchDirty && <Circle className="size-1.5 fill-amber-500 text-amber-500" />}
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

      {harness === "claude" && (
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors",
            SANDBOX_COLOR[sandboxLabel],
          )}
          title={`Sandbox ${sandboxLabel}`}
        >
          <Box className="size-3" />
          <span>{sandboxLabel}</span>
          <ChevronDown className="size-3" />
        </button>
      )}
    </div>
  )
}

function ContextDial({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct))
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const used = circumference * clamped
  const color = clamped > 0.7 ? "#ef4444" : clamped > 0.4 ? "#f59e0b" : "#22c55e"
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
            stroke={color}
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
