"use client"

import { useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Claude, OpenAI } from "@lobehub/icons"
import { Check, ChevronDown, Folder, FolderOpen, Plus } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@superone/ui/components/ui/tabs"
import { cn } from "@superone/ui/lib/utils"
import { ClaudeAgentIcon, CodexAgentIcon, type Harness } from "./icons"
import { DesktopShell, type DesktopShellProps } from "./desktop-shell"
import { ChatInputMock } from "./chat-input-mock"

export interface NewSessionMockProps extends Omit<DesktopShellProps, "children" | "headerTitle"> {
  harness?: Harness
  defaultHarness?: Harness
  onHarnessChange?: (harness: Harness) => void
  placeholder?: string
  showRecentProjects?: boolean
  frame?: number
  recentProjectsOpen?: boolean
  selectedProject?: string
  recentProjects?: string[]
}

const HARNESS_LABEL: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
}

const DEFAULT_RECENT_PROJECTS = ["super-one", "marketing-site", "experiments", "miniapp-playground"]

export function NewSessionMock({
  harness: harnessProp,
  defaultHarness = "claude",
  onHarnessChange,
  placeholder,
  showRecentProjects = true,
  frame,
  recentProjectsOpen,
  selectedProject,
  recentProjects = DEFAULT_RECENT_PROJECTS,
  ...shellProps
}: NewSessionMockProps) {
  const [internalHarness, setInternalHarness] = useState<Harness>(defaultHarness)
  const harness = harnessProp ?? internalHarness
  const isControlled = harnessProp !== undefined
  const isFrameDriven = frame !== undefined

  const handleChange = (next: Harness) => {
    if (!isControlled) setInternalHarness(next)
    onHarnessChange?.(next)
  }

  return (
    <DesktopShell headerTitle="New Session" {...shellProps}>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <HarnessFader harness={harness} disableMotion={isFrameDriven}>
            {harness === "claude" ? <ClaudeAgentIcon /> : <CodexAgentIcon />}
          </HarnessFader>

          <HarnessFader
            harness={harness}
            disableMotion={isFrameDriven}
            className="inline-flex items-center gap-1.5"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            duration={0.25}
          >
            <span className="text-xs text-muted-foreground">Powered by</span>
            {harness === "claude" ? (
              <span className="inline-flex items-center gap-1.5">
                <Claude.Color size={12} />
                <Claude.Text size={9} />
              </span>
            ) : (
              <OpenAI.Combine
                size={12}
                extra="ChatGPT"
                showText={false}
                style={{ display: "inline-flex", flexDirection: "row", alignItems: "center" }}
              />
            )}
          </HarnessFader>

          <Tabs value={harness} onValueChange={(v) => handleChange(v as Harness)}>
            <TabsList className="rounded-lg p-1">
              <TabsTrigger value="claude" className="rounded-md px-3 py-1.5 text-xs">
                {HARNESS_LABEL.claude}
              </TabsTrigger>
              <TabsTrigger value="codex" className="rounded-md px-3 py-1.5 text-xs">
                {HARNESS_LABEL.codex}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {showRecentProjects && (
            <RecentProjectsButton
              projects={recentProjects}
              selected={selectedProject ?? recentProjects[0] ?? ""}
              controlledOpen={recentProjectsOpen}
            />
          )}
        </div>

        <ChatInputMock
          harness={harness}
          placeholder={placeholder}
          contextPct={0}
        />
      </div>
    </DesktopShell>
  )
}

interface HarnessFaderProps {
  harness: Harness
  disableMotion: boolean
  className?: string
  initial?: { opacity: number; y?: number; scale?: number }
  animate?: { opacity: number; y?: number; scale?: number }
  exit?: { opacity: number; y?: number; scale?: number }
  duration?: number
  children: ReactNode
}

function HarnessFader({
  harness,
  disableMotion,
  className,
  initial = { opacity: 0, y: 12, scale: 0.85 },
  animate = { opacity: 1, y: 0, scale: 1 },
  exit = { opacity: 0, y: -12, scale: 0.85 },
  duration = 0.35,
  children,
}: HarnessFaderProps) {
  if (disableMotion) {
    return <div className={className}>{children}</div>
  }
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={harness}
        initial={initial}
        animate={animate}
        exit={exit}
        transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

interface RecentProjectsButtonProps {
  projects: string[]
  selected: string
  controlledOpen?: boolean
}

function RecentProjectsButton({ projects, selected, controlledOpen }: RecentProjectsButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const isControlled = controlledOpen !== undefined

  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => !isControlled && setInternalOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{selected}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
          <div className="px-2 py-1.5 text-xs font-normal text-muted-foreground">Select Project</div>
          {projects.map((name) => (
            <div
              key={name}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
              </div>
              {name === selected && <Check className="size-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
          <div className="my-1 h-px bg-border" />
          <div className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent">
            <Plus className="size-4 shrink-0" />
            <span>Add Project...</span>
          </div>
        </div>
      )}
    </div>
  )
}
