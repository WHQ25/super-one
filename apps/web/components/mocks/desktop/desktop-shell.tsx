"use client"

import type { ReactNode } from "react"
import {
  ArrowDownUp,
  Blocks,
  ChevronRight,
  CircleCheck,
  Folder,
  FolderOpen,
  GitFork,
  MessageSquare,
  Moon,
  Palette,
  PanelLeftDashed,
  Plus,
  Settings,
  Smartphone,
  SquarePen,
  Sun,
} from "lucide-react"
import { Button } from "@superone/ui/components/ui/button"
import { ScrollArea } from "@superone/ui/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@superone/ui/components/ui/tabs"
import { cn } from "@superone/ui/lib/utils"

export type SidebarTab = "sessions" | "files"
export type SessionStatus = "idle" | "running" | "unseen" | "worktree"

export interface MockSession {
  id: string
  title: string
  status?: SessionStatus
  active?: boolean
}

export interface MockProject {
  name: string
  active?: boolean
  expanded?: boolean
  sessions?: MockSession[]
}

export interface DesktopShellProps {
  projects?: MockProject[]
  headerTitle?: string
  sidebarTab?: SidebarTab
  showTrafficLights?: boolean
  height?: number | string
  children: ReactNode
  className?: string
}

const DEFAULT_PROJECTS: MockProject[] = [
  {
    name: "super-one",
    active: true,
    expanded: true,
    sessions: [
      { id: "s1", title: "Refactor sidebar layout", active: true, status: "running" },
      { id: "s2", title: "Fix relay reconnect bug", status: "unseen" },
      { id: "s3", title: "Polish miniapp permissions" },
      { id: "s4", title: "Worktree merge experiment", status: "worktree" },
    ],
  },
  {
    name: "marketing-site",
  },
  {
    name: "experiments",
  },
]

export function DesktopShell({
  projects = DEFAULT_PROJECTS,
  headerTitle = "New Session",
  sidebarTab = "sessions",
  showTrafficLights = true,
  height = "100%",
  children,
  className,
}: DesktopShellProps) {
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-xl border border-border bg-sidebar text-foreground shadow-sm",
        className,
      )}
      style={{ height }}
    >
      <Sidebar projects={projects} sidebarTab={sidebarTab} showTrafficLights={showTrafficLights} />
      <div className="flex min-w-0 flex-1 flex-col bg-card">
        <MainHeader title={headerTitle} />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

function MainHeader({ title }: { title: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center bg-card pl-3 pt-[2px]">
      <span className="max-w-[260px] truncate text-xs text-muted-foreground">{title}</span>
      <div className="flex-1" />
      <div className="mr-3 flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Toggle theme"
          className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Moon className="size-3.5 dark:hidden" />
          <Sun className="hidden size-3.5 dark:inline-block" />
        </button>
      </div>
    </div>
  )
}

function Sidebar({
  projects,
  sidebarTab,
  showTrafficLights,
}: {
  projects: MockProject[]
  sidebarTab: SidebarTab
  showTrafficLights: boolean
}) {
  return (
    <aside className="flex w-[320px] shrink-0 select-none flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-11 shrink-0 items-center pl-[18px]")}>
        {showTrafficLights && <TrafficLights />}
        {showTrafficLights && <div className="w-[18px] shrink-0" />}
        <button
          type="button"
          aria-label="Toggle sidebar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeftDashed className="size-3.5" />
        </button>
      </div>

      <div className="mx-2 mb-1 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center gap-1.5 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:border-border"
        >
          <SquarePen className="size-3.5" />
          New session
        </Button>
      </div>

      <Tabs value={sidebarTab} className="mx-2 mb-1 shrink-0">
        <TabsList variant="sidebar" className="h-8">
          <TabsTrigger value="sessions" className="py-1">
            <MessageSquare className="size-3.5" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="files" className="py-1">
            <Folder className="size-3.5" />
            Files
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AppsDrawerRow />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between pl-4 pr-3 pt-1.5 pb-0.5">
          <span className="text-sm font-medium text-sidebar-foreground/40">Projects</span>
          <div className="flex items-center gap-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 cursor-pointer text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 cursor-pointer text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
            >
              <ArrowDownUp className="size-3" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex w-0 min-w-full flex-col px-1.5 pb-1.5">
              {projects.map((project) => (
                <ProjectRow key={project.name} project={project} />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      <SidebarFooter />
    </aside>
  )
}

function ProjectRow({ project }: { project: MockProject }) {
  const isExpanded = project.expanded ?? false
  const Icon = isExpanded ? FolderOpen : Folder
  return (
    <div>
      <div
        className={cn(
          "group flex h-9 items-center overflow-hidden rounded-md px-2.5 transition-colors",
          "cursor-pointer hover:bg-sidebar-accent",
        )}
      >
        <ChevronRight
          className={cn(
            "hidden size-4 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-hover:block",
            isExpanded && "rotate-90",
          )}
        />
        <Icon className="size-4 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
        <span className="ml-2 min-w-0 truncate text-[14px]">{project.name}</span>
        <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground"
            aria-label="New session"
          >
            <SquarePen className="size-4" />
          </button>
        </div>
      </div>

      {isExpanded && project.sessions && project.sessions.length > 0 && (
        <div className="overflow-hidden pl-5">
          {project.sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ session }: { session: MockSession }) {
  return (
    <div
      className={cn(
        "group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors",
        session.active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
      )}
    >
      <span className="flex size-3 shrink-0 items-center justify-center">
        <SessionStatusIcon status={session.status} />
      </span>
      <span className="min-w-0 truncate text-[13px]">{session.title}</span>
    </div>
  )
}

function SessionStatusIcon({ status }: { status?: SessionStatus }) {
  if (status === "running") {
    return (
      <span
        aria-label="Running"
        className="size-2 rounded-full bg-sidebar-foreground/40"
        style={{ animation: "pulse 1.5s ease-in-out infinite" }}
      />
    )
  }
  if (status === "unseen") return <CircleCheck className="size-3 text-green-600 dark:text-green-400" />
  if (status === "worktree") return <GitFork className="size-3 text-sidebar-foreground/70" />
  return <MessageSquare className="size-3 text-sidebar-foreground/70" />
}

function SidebarFooter() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <button
        className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label="Settings"
      >
        <Settings className="size-3.5" />
      </button>
      <button
        className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hidden"
        aria-label="Brand color"
      >
        <Palette className="size-3.5" />
      </button>
      <button
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label="Remote"
      >
        <Smartphone className="size-3.5" />
        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-green-500" />
      </button>
    </div>
  )
}

function AppsDrawerRow() {
  return (
    <div className="mx-2 mb-1 shrink-0">
      <div className="overflow-hidden rounded-md border border-sidebar-border">
        <button className="flex h-[30px] w-full cursor-pointer items-center justify-between px-2.5 transition-colors hover:bg-sidebar-accent">
          <span className="flex items-center gap-2">
            <Blocks className="size-3.5 text-sidebar-foreground/50" />
            <span className="text-xs text-sidebar-foreground/50">Apps</span>
          </span>
          <ChevronRight className="size-3.5 text-sidebar-foreground/50" />
        </button>
      </div>
    </div>
  )
}

function TrafficLights() {
  return (
    <div className="flex shrink-0 items-center gap-2 pl-1">
      <span className="size-3 rounded-full bg-[#ff5f57]" />
      <span className="size-3 rounded-full bg-[#febc2e]" />
      <span className="size-3 rounded-full bg-[#28c840]" />
    </div>
  )
}
