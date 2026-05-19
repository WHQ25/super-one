"use client"

import { PanelBottomClose, Plus, Terminal as TerminalIcon } from "lucide-react"
import { cn } from "@superone/ui/lib/utils"

export type MockTerminalColor =
  | "green"
  | "blue"
  | "yellow"
  | "red"
  | "magenta"
  | "cyan"
  | "muted"

export interface MockTerminalSegment {
  text: string
  color?: MockTerminalColor
  bold?: boolean
}

export type MockTerminalLine = string | MockTerminalSegment[]

export interface MockTerminalTab {
  id: string
  title: string
  active?: boolean
}

export interface TerminalPanelMockProps {
  tabs?: MockTerminalTab[]
  lines?: MockTerminalLine[]
  cursor?: boolean
  className?: string
}

const SEGMENT_COLOR: Record<MockTerminalColor, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  blue: "text-sky-600 dark:text-sky-400",
  yellow: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  magenta: "text-fuchsia-600 dark:text-fuchsia-400",
  cyan: "text-teal-600 dark:text-teal-400",
  muted: "text-muted-foreground",
}

const DEFAULT_TABS: MockTerminalTab[] = [
  { id: "t1", title: "zsh", active: true },
  { id: "t2", title: "bun run dev" },
]

function promptLine(command: string): MockTerminalSegment[] {
  return [
    { text: "➜  ", color: "green", bold: true },
    { text: "super-one ", color: "cyan" },
    { text: "git:(", color: "blue" },
    { text: "main", color: "red" },
    { text: ") ", color: "blue" },
    { text: command },
  ]
}

const DEFAULT_LINES: MockTerminalLine[] = [
  promptLine("bun run test"),
  [{ text: "$ vitest run", color: "muted" }],
  [{ text: " ✓ ", color: "green" }, { text: "src/main/session/session.test.ts (12)" }],
  [{ text: " ✓ ", color: "green" }, { text: "src/renderer/src/stores/chat-store.test.ts (9)" }],
  [{ text: " ✓ ", color: "green" }, { text: "packages/shared/src/agent-types.test.ts (5)" }],
  "",
  [
    { text: " Test Files  ", color: "muted" },
    { text: "3 passed", color: "green" },
    { text: " (3)", color: "muted" },
  ],
  [
    { text: "      Tests  ", color: "muted" },
    { text: "26 passed", color: "green" },
    { text: " (26)", color: "muted" },
  ],
  [{ text: "   Duration  1.84s", color: "muted" }],
  "",
  promptLine(""),
]

function TerminalTab({ tab }: { tab: MockTerminalTab }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors",
        tab.active ? "bg-muted text-foreground" : "text-muted-foreground",
      )}
    >
      <TerminalIcon className="size-3 shrink-0" />
      <span className="max-w-40 truncate text-xs">{tab.title}</span>
    </div>
  )
}

function TerminalLine({ line, cursor }: { line: MockTerminalLine; cursor?: boolean }) {
  const segments: MockTerminalSegment[] = typeof line === "string" ? [{ text: line }] : line
  return (
    <div className="whitespace-pre">
      {segments.length === 0 || (segments.length === 1 && segments[0].text === "") ? (
        <span>{" "}</span>
      ) : (
        segments.map((seg, i) => (
          <span
            key={i}
            className={cn(seg.color && SEGMENT_COLOR[seg.color], seg.bold && "font-semibold")}
          >
            {seg.text}
          </span>
        ))
      )}
      {cursor && (
        <span className="ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.15em] bg-foreground/80" />
      )}
    </div>
  )
}

export function TerminalPanelMock({
  tabs = DEFAULT_TABS,
  lines = DEFAULT_LINES,
  cursor = true,
  className,
}: TerminalPanelMockProps) {
  return (
    <div className={cn("flex h-full flex-col bg-card", className)}>
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {tabs.map((tab) => (
            <TerminalTab key={tab.id} tab={tab} />
          ))}
          <div className="flex shrink-0 items-center rounded-lg px-1.5 py-1 text-muted-foreground">
            <Plus className="size-4" />
          </div>
        </div>
        <div className="flex shrink-0 items-center rounded-lg px-1.5 py-1 text-muted-foreground">
          <PanelBottomClose className="size-4" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-1.5 font-mono text-[13px] leading-relaxed text-foreground">
        {lines.map((line, i) => (
          <TerminalLine key={i} line={line} cursor={cursor && i === lines.length - 1} />
        ))}
      </div>
    </div>
  )
}
