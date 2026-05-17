"use client"

import type { ReactNode } from "react"
import {
  ArrowDownUp,
  Blocks,
  Bot,
  ChevronRight,
  CircleCheck,
  Folder,
  FolderOpen,
  GitFork,
  Loader2,
  MessageSquare,
  Moon,
  Palette,
  PanelLeftDashed,
  PanelLeftOpen,
  PanelRightOpen,
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
import { useMockT } from "./i18n"

export type SidebarTab = "sessions" | "files"
export type SessionStatus = "idle" | "running" | "unseen" | "worktree"

export interface MockSession {
  id: string
  title: string
  status?: SessionStatus
  active?: boolean
  pendingReason?: string
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
  fileTree?: ReactNode
  showTrafficLights?: boolean
  showActivityPanelToggle?: boolean
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
      { id: "s2", title: "Fix relay reconnect bug", status: "unseen", pendingReason: "Allow Bash?" },
      { id: "s3", title: "Polish miniapp permissions", status: "unseen", pendingReason: "Review plan" },
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
  headerTitle,
  sidebarTab = "sessions",
  fileTree,
  showTrafficLights = true,
  showActivityPanelToggle = false,
  height = "100%",
  children,
  className,
}: DesktopShellProps) {
  const t = useMockT()
  const resolvedHeaderTitle = headerTitle ?? t("sidebar.newSession")
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-xl border border-border bg-sidebar text-foreground shadow-sm",
        className,
      )}
      style={{ height }}
    >
      <DesktopSidebar
        projects={projects}
        sidebarTab={sidebarTab}
        fileTree={fileTree}
        showTrafficLights={showTrafficLights}
        showActivityPanelToggle={showActivityPanelToggle}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-card">
        <DesktopMainHeader title={resolvedHeaderTitle} />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

export interface DesktopSidebarProps {
  projects?: MockProject[]
  sidebarTab?: SidebarTab
  fileTree?: ReactNode
  showTrafficLights?: boolean
  showActivityPanelToggle?: boolean
  width?: number | string
  layoutToggleSide?: "right" | "left"
}

export function DesktopSidebar({
  projects = DEFAULT_PROJECTS,
  sidebarTab = "sessions",
  fileTree,
  showTrafficLights = true,
  showActivityPanelToggle = false,
  width,
  layoutToggleSide = "right",
}: DesktopSidebarProps) {
  return (
    <Sidebar
      projects={projects}
      sidebarTab={sidebarTab}
      fileTree={fileTree}
      showTrafficLights={showTrafficLights}
      showActivityPanelToggle={showActivityPanelToggle}
      width={width}
      layoutToggleSide={layoutToggleSide}
    />
  )
}

export interface DesktopMainHeaderProps {
  title: string
}

export function DesktopMainHeader({ title }: DesktopMainHeaderProps) {
  return <MainHeader title={title} />
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
  fileTree,
  showTrafficLights,
  showActivityPanelToggle,
  width,
  layoutToggleSide = "right",
}: {
  projects: MockProject[]
  sidebarTab: SidebarTab
  fileTree?: ReactNode
  showTrafficLights: boolean
  showActivityPanelToggle: boolean
  width?: number | string
  layoutToggleSide?: "right" | "left"
}) {
  const t = useMockT()
  const showFileTree = sidebarTab === "files" && !!fileTree
  const resolvedWidth = width ?? 320
  return (
    <aside
      className="flex shrink-0 select-none flex-col bg-sidebar text-sidebar-foreground"
      style={{ width: resolvedWidth }}
    >
      <div className={cn("flex h-11 shrink-0 items-center gap-2 pt-[2px]", showTrafficLights ? "pl-[18px]" : "pl-2")}>
        {showTrafficLights && <TrafficLights />}
        <LayoutToggleMock showActivityPanelToggle={showActivityPanelToggle} side={layoutToggleSide} />
      </div>

      <div className="mx-2 mb-1 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="mb-1 w-full justify-center gap-1.5 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:border-border"
        >
          <SquarePen className="size-3.5" />
          {t("sidebar.newSession")}
        </Button>
      </div>

      <Tabs value={sidebarTab} className="mx-2 mb-1 shrink-0">
        <TabsList variant="sidebar">
          <TabsTrigger value="sessions" className="py-1">
            <MessageSquare className="size-3.5" />
            {t("sidebar.tabs.sessions")}
          </TabsTrigger>
          <TabsTrigger value="files" className="py-1">
            <Folder className="size-3.5" />
            {t("sidebar.tabs.files")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AppsDrawerRow />

      <div className="flex min-h-0 flex-1 flex-col">
        {showFileTree ? (
          <div className="min-h-0 flex-1">{fileTree}</div>
        ) : (
          <>
            <div className="flex items-center justify-between pl-4 pr-3 pt-1.5 pb-0.5">
              <span className="text-sm font-medium text-sidebar-foreground/40">{t("sidebar.projects")}</span>
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
          </>
        )}
      </div>

      <SidebarFooter />
    </aside>
  )
}

function ProjectRow({ project }: { project: MockProject }) {
  const t = useMockT()
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
        <Icon className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
        <span className="ml-2 min-w-0 truncate text-md">{project.name}</span>
        <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground"
            aria-label={t("sidebar.newSession")}
          >
            <SquarePen className="size-4" />
          </button>
        </div>
      </div>

      {isExpanded && project.sessions && project.sessions.length > 0 && (
        <div className="overflow-hidden">
          <div className="flex flex-col py-0.5 pl-5">
            {project.sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SessionRow({ session }: { session: MockSession }) {
  return (
    <div>
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
      {session.pendingReason && (
        <div className="ml-5 mr-1 mt-0.5 flex cursor-pointer items-center gap-1 rounded-md bg-green-500/15 px-2 py-1">
          <Bot className="size-3 shrink-0 text-green-600 dark:text-green-400" />
          <span className="min-w-0 truncate text-[11px] text-green-600 dark:text-green-400">
            {session.pendingReason}
          </span>
        </div>
      )}
    </div>
  )
}

function SessionStatusIcon({ status }: { status?: SessionStatus }) {
  if (status === "running") return <Loader2 className="size-3 animate-spin text-sidebar-foreground/70" />
  if (status === "unseen") return <CircleCheck className="size-3 text-green-600 dark:text-green-400" />
  if (status === "worktree") return <GitFork className="size-3 text-sidebar-foreground/70" />
  return <MessageSquare className="size-3 text-sidebar-foreground/70" />
}

function SidebarFooter() {
  const t = useMockT()
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <button
        className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label={t("sidebar.settings")}
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
    <div className="mx-2 mt-1 mb-1 shrink-0">
      <div className="overflow-hidden rounded-lg border border-sidebar-border">
        <button className="flex min-h-[30px] w-full cursor-pointer items-center justify-between px-2.5 py-1 transition-colors hover:bg-sidebar-accent">
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

function LayoutToggleMock({
  showActivityPanelToggle,
  side = "right",
}: {
  showActivityPanelToggle: boolean
  side?: "right" | "left"
}) {
  const t = useMockT()
  return (
    <div className="mr-2 flex items-center gap-0.5">
      <button
        type="button"
        aria-label={t("tooltips.toggleSidebar")}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <PanelLeftDashed className="size-3.5" />
      </button>
      {showActivityPanelToggle && (
        <button
          type="button"
          aria-label="Toggle activity panel side"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {side === "right" ? <PanelRightOpen className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
        </button>
      )}
    </div>
  )
}


function TrafficLights() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-inset ring-black/10" />
    </div>
  )
}
