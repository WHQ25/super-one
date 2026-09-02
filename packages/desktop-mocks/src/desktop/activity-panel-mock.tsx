"use client"

import { type ReactNode, useEffect, useState } from "react"
import {
  Blocks,
  Globe,
  Maximize,
  MessageCirclePlus,
  Plus,
  Route,
  Shrink,
  Smartphone,
  SquareTerminal,
  X,
} from "lucide-react"
import { Button } from "@superone/ui/components/ui/button"
import { FileIcon } from "@superone/ui/components/ui/FileIcon"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@superone/ui/components/ui/tooltip"
import { cn } from "@superone/ui/lib/utils"
import { SideChatMock } from "./side-chat-mock"

export type ActivityTabKind =
  | "file"
  | "mini-app"
  | "browser"
  | "terminal"
  | "trajectory"
  | "device"
  | "side-chat"

export interface MockActivityTab {
  id: string
  kind: ActivityTabKind
  title: string
  fileName?: string
}

export interface ActivityPanelMockProps {
  tabs?: MockActivityTab[]
  activeTabId?: string
  maximized?: boolean
  forceCloseTabId?: string
  sideChatCloseConfirmationOpen?: boolean
  children?: ReactNode
  className?: string
}

export const DEFAULT_ACTIVITY_TABS: MockActivityTab[] = [
  { id: "file", kind: "file", title: "File", fileName: "ActivityPanel.tsx" },
  { id: "mini-app", kind: "mini-app", title: "Mini App" },
  { id: "browser", kind: "browser", title: "Browser" },
  { id: "terminal", kind: "terminal", title: "Terminal" },
  { id: "trajectory", kind: "trajectory", title: "Trajectory" },
  { id: "device", kind: "device", title: "Device" },
  { id: "side-chat", kind: "side-chat", title: "Side Chat" },
]

function TabGlyph({ tab }: { tab: MockActivityTab }) {
  if (tab.kind === "file") {
    return <FileIcon name={tab.fileName ?? tab.title} size={14} className="shrink-0" />
  }

  const Icon = {
    "mini-app": Blocks,
    browser: Globe,
    terminal: SquareTerminal,
    trajectory: Route,
    device: Smartphone,
    "side-chat": MessageCirclePlus,
  }[tab.kind]

  return <Icon aria-hidden />
}

interface ActivityTabChipProps {
  tab: MockActivityTab
  active: boolean
  maximized: boolean
  forceClose: boolean
  onActivate: () => void
  onClose: () => void
  onToggleMaximize: () => void
}

function ActivityTabChip({
  tab,
  active,
  maximized,
  forceClose,
  onActivate,
  onClose,
  onToggleMaximize,
}: ActivityTabChipProps) {
  return (
    <div
      className={cn(
        "group/tab flex h-7 shrink-0 items-center gap-1 rounded-lg px-1 transition-colors",
        active ? "max-w-[200px] bg-muted text-foreground" : "max-w-[128px] text-muted-foreground hover:text-foreground",
      )}
      data-active={active || undefined}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="relative size-4 rounded-full"
            aria-label={`Close ${tab.title}`}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center transition-opacity group-hover/tab:opacity-0",
                forceClose && "opacity-0",
              )}
            >
              <TabGlyph tab={tab} />
            </span>
            <X
              className={cn(
                "absolute opacity-0 transition-opacity group-hover/tab:opacity-100",
                forceClose && "opacity-100",
              )}
              aria-hidden
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close {tab.title}</TooltipContent>
      </Tooltip>

      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs"
        onClick={onActivate}
      >
        {tab.title}
      </button>

      {active && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-4"
              aria-label={maximized ? "Restore activity panel" : "Maximize activity panel"}
              onClick={(event) => {
                event.stopPropagation()
                onToggleMaximize()
              }}
            >
              {maximized ? <Shrink aria-hidden /> : <Maximize aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {maximized ? "Restore activity panel" : "Maximize activity panel"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function ActivitySurface({ tab }: { tab: MockActivityTab | undefined }) {
  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open an activity to begin
      </div>
    )
  }

  if (tab.kind === "side-chat") return <SideChatMock />

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <TabGlyph tab={tab} />
      </div>
      <div className="text-sm font-medium">{tab.title}</div>
      <p className="max-w-xs text-xs text-muted-foreground">
        {tab.kind === "file" ? "File preview" : `${tab.kind.replace("-", " ")} activity`} inside the shared panel.
      </p>
    </div>
  )
}

export function ActivityPanelMock({
  tabs = DEFAULT_ACTIVITY_TABS,
  activeTabId = "side-chat",
  maximized = false,
  forceCloseTabId,
  sideChatCloseConfirmationOpen = false,
  children,
  className,
}: ActivityPanelMockProps) {
  const [visibleTabs, setVisibleTabs] = useState(tabs)
  const [selectedId, setSelectedId] = useState(activeTabId)
  const [isMaximized, setIsMaximized] = useState(maximized)
  const [sideChatConfirmOpen, setSideChatConfirmOpen] = useState(sideChatCloseConfirmationOpen)

  useEffect(() => setVisibleTabs(tabs), [tabs])
  useEffect(() => setSelectedId(activeTabId), [activeTabId])
  useEffect(() => setIsMaximized(maximized), [maximized])
  useEffect(() => setSideChatConfirmOpen(sideChatCloseConfirmationOpen), [sideChatCloseConfirmationOpen])

  const discardTab = (id: string) => {
    setVisibleTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      if (selectedId === id) {
        setSelectedId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? "")
      }
      return next
    })
  }

  const closeTab = (tab: MockActivityTab) => {
    if (tab.kind === "side-chat") {
      setSideChatConfirmOpen(true)
      return
    }
    discardTab(tab.id)
  }

  const activeTab = visibleTabs.find((tab) => tab.id === selectedId) ?? visibleTabs[0]

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm",
          isMaximized && "ring-1 ring-ring/30",
          className,
        )}
      >
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-card px-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <ActivityTabChip
                key={tab.id}
                tab={tab}
                active={tab.id === activeTab?.id}
                maximized={isMaximized}
                forceClose={tab.id === forceCloseTabId}
                onActivate={() => setSelectedId(tab.id)}
                onClose={() => closeTab(tab)}
                onToggleMaximize={() => setIsMaximized((value) => !value)}
              />
            ))}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="New activity tab">
                <Plus aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New activity tab</TooltipContent>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1">
          {children ?? (
            activeTab?.kind === "side-chat" ? (
              <SideChatMock
                closeConfirmationOpen={sideChatConfirmOpen}
                onCloseConfirmationChange={setSideChatConfirmOpen}
                onConfirmClose={() => discardTab(activeTab.id)}
              />
            ) : (
              <ActivitySurface tab={activeTab} />
            )
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
