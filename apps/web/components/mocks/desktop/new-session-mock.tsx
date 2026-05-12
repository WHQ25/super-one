"use client"

import { useState } from "react"
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
}

const HARNESS_LABEL: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
}

const RECENT_PROJECTS = ["super-one", "marketing-site", "experiments", "miniapp-playground"]

export function NewSessionMock({
  harness: harnessProp,
  defaultHarness = "claude",
  onHarnessChange,
  placeholder,
  showRecentProjects = true,
  ...shellProps
}: NewSessionMockProps) {
  const [internalHarness, setInternalHarness] = useState<Harness>(defaultHarness)
  const harness = harnessProp ?? internalHarness
  const isControlled = harnessProp !== undefined

  const handleChange = (next: Harness) => {
    if (!isControlled) setInternalHarness(next)
    onHarnessChange?.(next)
  }

  return (
    <DesktopShell headerTitle="New Session" {...shellProps}>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={harness}
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.85 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {harness === "claude" ? <ClaudeAgentIcon /> : <CodexAgentIcon />}
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.span
              key={harness}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="inline-flex items-center gap-1.5"
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
            </motion.span>
          </AnimatePresence>

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

          {showRecentProjects && <RecentProjectsButton />}
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

function RecentProjectsButton() {
  const [open, setOpen] = useState(false)
  const current = RECENT_PROJECTS[0]
  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
          <div className="px-2 py-1.5 text-xs font-normal text-muted-foreground">Select Project</div>
          {RECENT_PROJECTS.map((name) => (
            <div
              key={name}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
              </div>
              {name === current && <Check className="size-4 shrink-0 text-muted-foreground" />}
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
